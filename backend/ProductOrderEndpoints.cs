using System.Security.Claims;
using System.Net.Mail;
using Dapper;
using Npgsql;
using StudentHub.Api.Data;

namespace StudentHub.Api;

//TO DO revisar dapers si estamos pasando parametros bienn
public static partial class SalonEndpoints
{
    private static async Task<IResult> CreateCartOrder(
        string slug, CreateCartOrderRequest request, IProductOrderService orders,
        ILoggerFactory loggerFactory, CancellationToken cancellationToken)
    {
        try
        {
            var order = await orders.CreateAsync(slug, request, cancellationToken);
            return TypedResults.Created($"/api/public/salons/{slug}/store/orders/{order.Id}", order);
        }
        catch (StoreOrderException exception)
        {
            loggerFactory.CreateLogger("ProductOrders").LogWarning(exception, "No se pudo crear el pedido");
            return Results.Json(new { message = exception.Message }, statusCode: exception.StatusCode);
        }
    }

    private static async Task<IResult> GetProductOrders(
        ClaimsPrincipal user, IDbConnectionFactory db, IProductOrderService orders,
        CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null) return TypedResults.NotFound();
        if (!await SalonHasProductsModule(salonId.Value, db, cancellationToken)) return TypedResults.Forbid();
        return TypedResults.Ok(await orders.ListAsync(salonId.Value, cancellationToken));
    }

    private static async Task<IResult> UpdateProductOrder(
        Guid id, UpdateProductOrderRequest request, ClaimsPrincipal user, IDbConnectionFactory db,
        IProductOrderService orders, ILoggerFactory loggerFactory, CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null) return TypedResults.NotFound();
        if (!await SalonHasProductsModule(salonId.Value, db, cancellationToken)) return TypedResults.Forbid();
        try
        {
            await orders.UpdateAsync(salonId.Value, id, request, cancellationToken);
            return TypedResults.Ok(new { id });
        }
        catch (StoreOrderException exception)
        {
            loggerFactory.CreateLogger("ProductOrders").LogWarning(exception, "No se pudo actualizar {OrderId}", id);
            return Results.Json(new { message = exception.Message }, statusCode: exception.StatusCode);
        }
        catch (PostgresException exception) when (exception.SqlState == "P0001")
        {
            loggerFactory.CreateLogger("ProductOrders").LogWarning(exception, "Stock insuficiente para entregar {OrderId}", id);
            return TypedResults.Conflict(new { message = "No hay stock suficiente. Revisá el stock antes de entregar el pedido." });
        }
    }
}

public interface IProductOrderService
{
    Task<CreatedCartOrderResponse> CreateAsync(string slug, CreateCartOrderRequest request, CancellationToken ct);
    Task<IReadOnlyList<ProductOrderResponse>> ListAsync(Guid salonId, CancellationToken ct);
    Task UpdateAsync(Guid salonId, Guid id, UpdateProductOrderRequest request, CancellationToken ct);
}

public sealed class ProductOrderService(
    IDbConnectionFactory db, MercadoPagoService mercadoPago, ILogger<ProductOrderService> logger) : IProductOrderService
{
    public async Task<CreatedCartOrderResponse> CreateAsync(string slug, CreateCartOrderRequest request, CancellationToken ct)
    {
        if (request.Items is not { Count: > 0 and <= 50 }
            || request.Items.Any(i => i is null || i.ProductId == Guid.Empty || i.Quantity is < 1 or > 99)
            || request.Items.Select(i => i.ProductId).Distinct().Count() != request.Items.Count)
            throw new StoreOrderException(400, "Agregá entre 1 y 50 productos distintos, con cantidades de 1 a 99.");
        if (string.IsNullOrWhiteSpace(request.CustomerName) || request.CustomerName.Length > 200
            || string.IsNullOrWhiteSpace(request.CustomerPhone) || request.CustomerPhone.Length > 50
            || string.IsNullOrWhiteSpace(request.CustomerEmail) || request.CustomerEmail.Length > 254
            || !MailAddress.TryCreate(request.CustomerEmail.Trim(), out var email)
            || email.Address != request.CustomerEmail.Trim())
            throw new StoreOrderException(400, "Ingresá nombre, teléfono y un email válido.");
        if (request.PaymentMethod is not ("salon" or "mercadopago"))
            throw new StoreOrderException(400, "Elegí pagar con Mercado Pago o al retirar.");
        var online = request.PaymentMethod == "mercadopago";
        if (online && !mercadoPago.IsConfigured)
            throw new StoreOrderException(503, "Mercado Pago no está disponible. Podés reservar y pagar al retirar.");

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        var products = (await connection.QueryAsync<CartProduct>(new CommandDefinition(
            """
            select p.id as "Id", p.name as "Name", p.price as "Price", p.stock as "Stock",
                   s.id as "SalonId"
            from public.products p
            join public.salons s on s.id = p.salon_id
            where s.slug = @Slug and s.active and s.store_enabled and p.active
              and p.id = any(@Ids)
              and exists (
                select 1 from public.salon_modules sm
                join public.platform_modules pm on pm.key = sm.module_key
                where sm.salon_id = s.id and sm.module_key = 'products' and sm.enabled and pm.active
              )
            order by p.id
            for update of p
            """, new { Slug = slug, Ids = request.Items.Select(i => i.ProductId).ToArray() },
            transaction, cancellationToken: ct))).AsList();
        if (products.Count != request.Items.Count || products.Any(p => p.Price <= 0))
            throw new StoreOrderException(409, "Uno de los productos ya no está disponible para comprar.");

        foreach (var product in products)
        {
            var quantity = request.Items.Single(i => i.ProductId == product.Id).Quantity;
            var reserved = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                select coalesce(sum(i.quantity), 0)::int
                from public.product_order_items i
                join public.product_orders o on o.id = i.order_id
                where i.product_id = @Id and o.status = 'pending' and o.payment_status = 'pending'
                  and (o.payment_expires_at is null or o.payment_expires_at > now())
                """, new { product.Id }, transaction, cancellationToken: ct));
            if (product.Stock is not null && product.Stock - reserved < quantity)
                throw new StoreOrderException(409, $"No hay stock suficiente de {product.Name}. Revisá el carrito.");
        }

        var id = Guid.NewGuid();
        var total = products.Sum(p => p.Price * request.Items.Single(i => i.ProductId == p.Id).Quantity);
        if (total > 9_999_999_999.99m)
            throw new StoreOrderException(400, "El importe del pedido supera el máximo permitido.");
        var expires = DateTimeOffset.UtcNow.AddMinutes(20);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            insert into public.product_orders
              (id, salon_id, customer_name, customer_phone, customer_email, quantity, unit_price,
               payment_method, payment_status, status, payment_expires_at)
            values (@Id, @SalonId, @Name, @Phone, @Email, 1, @Total,
                    @Method, @PaymentStatus, 'pending', @Expires)
            """, new
            {
                Id = id, products[0].SalonId, Name = request.CustomerName.Trim(),
                Phone = request.CustomerPhone.Trim(), Email = email.Address, Total = total,
                Method = request.PaymentMethod, PaymentStatus = online ? "pending" : "unpaid",
                Expires = online ? expires : (DateTimeOffset?)null,
            }, transaction, cancellationToken: ct));
        var items = products.Select(p => new ProductOrderItemResponse(
            p.Id, p.Name, request.Items.Single(i => i.ProductId == p.Id).Quantity, p.Price)).ToArray();
        foreach (var item in items)
            await connection.ExecuteAsync(new CommandDefinition(
                """
                insert into public.product_order_items (order_id, product_id, product_name, quantity, unit_price)
                values (@OrderId, @ProductId, @ProductName, @Quantity, @UnitPrice)
                """, new { OrderId = id, item.ProductId, item.ProductName, item.Quantity, item.UnitPrice },
                transaction, cancellationToken: ct));

        string? checkoutUrl = null;
        if (online)
        {
            var returnUrl = $"{mercadoPago.PublicAppUrl}/s/{Uri.EscapeDataString(slug)}/tienda?pedido={id}";
            MercadoPagoPreference preference;
            try
            {
                preference = await mercadoPago.CreatePreferenceAsync(new MercadoPagoPreferenceRequest(
                    $"store:{id}", slug, "Compra en la tienda", "Retiro de productos en el salón",
                    total, request.CustomerName.Trim(), email.Address,
                    $"{returnUrl}&pago=ok", $"{returnUrl}&pago=error", $"{returnUrl}&pago=pendiente",
                    expires, mercadoPago.PublicApiUrl is { } apiUrl
                        ? $"{apiUrl}/api/public/payments/mercadopago/webhook" : null,
                    ItemCategory: "others", Metadata: new { store_order_id = id.ToString(), salon_slug = slug },
                    Items: items.Select(i => new MercadoPagoPreferenceItem(
                        i.ProductId.ToString(), i.ProductName, i.Quantity, i.UnitPrice)).ToArray()), ct);
            }
            catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException
                || exception is OperationCanceledException && !ct.IsCancellationRequested)
            {
                logger.LogError(exception, "Error de Mercado Pago al crear {OrderId}", id);
                throw new StoreOrderException(502, "No se pudo iniciar Mercado Pago. Intentá nuevamente.");
            }
            checkoutUrl = preference.CheckoutUrl;
            await connection.ExecuteAsync(new CommandDefinition(
                "update public.product_orders set mp_preference_id = @PreferenceId where id = @Id",
                new { Id = id, PreferenceId = preference.Id }, transaction, cancellationToken: ct));
        }
        else
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "update public.product_orders set status = 'confirmed' where id = @Id",
                new { Id = id }, transaction, cancellationToken: ct));
        }
        await transaction.CommitAsync(ct);
        return new(id, string.Join(", ", items.Select(i => $"{i.ProductName} × {i.Quantity}")),
            online ? "pending" : "unpaid", online ? "pending" : "confirmed", total, checkoutUrl, items);
    }

    public async Task<IReadOnlyList<ProductOrderResponse>> ListAsync(Guid salonId, CancellationToken ct)
    {
        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(ct);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            update public.product_orders set status = 'cancelled', payment_status = 'failed'
            where salon_id = @SalonId and status = 'pending' and payment_status = 'pending'
              and payment_method = 'mercadopago' and payment_expires_at < now()
            """, new { SalonId = salonId }, cancellationToken: ct));
        using var result = await connection.QueryMultipleAsync(new CommandDefinition(
            """
            select id as "Id", customer_name as "CustomerName", customer_phone as "CustomerPhone",
                   customer_email as "CustomerEmail", payment_method as "PaymentMethod",
                   payment_status as "PaymentStatus", status as "Status",
                   created_at as "CreatedAt", delivered_at as "DeliveredAt"
            from public.product_orders where salon_id = @SalonId order by created_at desc;
            select i.order_id as "OrderId", i.product_id as "ProductId", i.product_name as "ProductName",
                   i.quantity as "Quantity", i.unit_price as "UnitPrice"
            from public.product_order_items i
            join public.product_orders o on o.id = i.order_id where o.salon_id = @SalonId;
            """, new { SalonId = salonId }, cancellationToken: ct));
        var orders = await result.ReadAsync<OrderRow>();
        var items = (await result.ReadAsync<ItemRow>()).ToLookup(i => i.OrderId);
        return orders.Select(o => new ProductOrderResponse(
            o.Id, o.CustomerName, o.CustomerPhone, o.CustomerEmail, o.PaymentMethod, o.PaymentStatus,
            o.Status, o.CreatedAt, o.DeliveredAt,
            items[o.Id].Sum(i => i.UnitPrice * i.Quantity),
            items[o.Id].Select(i => new ProductOrderItemResponse(
                i.ProductId, i.ProductName, i.Quantity, i.UnitPrice)).ToArray())).ToArray();
    }

    public async Task UpdateAsync(Guid salonId, Guid id, UpdateProductOrderRequest request, CancellationToken ct)
    {
        if (request.Action is not ("pay" or "deliver" or "undeliver" or "cancel"))
            throw new StoreOrderException(400, "Acción de pedido inválida.");
        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);
        var order = await connection.QuerySingleOrDefaultAsync<OrderRow>(new CommandDefinition(
            """
            select id as "Id", customer_name as "CustomerName", customer_phone as "CustomerPhone",
                   customer_email as "CustomerEmail", payment_method as "PaymentMethod",
                   payment_status as "PaymentStatus", status as "Status",
                   created_at as "CreatedAt", delivered_at as "DeliveredAt"
            from public.product_orders where id = @Id and salon_id = @SalonId for update
            """, new { Id = id, SalonId = salonId }, transaction, cancellationToken: ct));
        if (order is null) throw new StoreOrderException(404, "No encontramos ese pedido.");
        if (order.Status == "cancelled")
            throw new StoreOrderException(409, "El pedido está cancelado.");
        if (request.Action == "pay" && order.PaymentMethod != "salon")
            throw new StoreOrderException(409, "Los pagos de Mercado Pago se acreditan automáticamente.");
        if (request.Action == "pay" && request.PaymentChannel is not ("cash" or "transfer" or "debit" or "credit"))
            throw new StoreOrderException(400, "Elegí efectivo, transferencia, débito o crédito para registrar el cobro.");
        if (request.Action == "cancel" && (order.PaymentMethod != "salon"
            || order.PaymentStatus == "paid" || order.DeliveredAt is not null))
            throw new StoreOrderException(409, "No se puede cancelar un pedido pagado o entregado. Gestioná primero la devolución.");
        if (request.Action == "deliver" && order.Status != "confirmed"
            && !(order.Status == "awaiting_stock" && order.PaymentStatus == "paid"))
            throw new StoreOrderException(409, "Esperá la confirmación del pedido antes de entregarlo.");
        var sql = request.Action switch
        {
            "pay" => """
                update public.product_orders
                set payment_status = 'paid', payment_channel = @PaymentChannel,
                    paid_at = coalesce(paid_at, now())
                where id = @Id
                """,
            "deliver" => "update public.product_orders set status = 'confirmed', delivered_at = coalesce(delivered_at, now()) where id = @Id",
            "undeliver" => "update public.product_orders set delivered_at = null where id = @Id",
            _ => "update public.product_orders set status = 'cancelled' where id = @Id",
        };
        await connection.ExecuteAsync(new CommandDefinition(sql,
            new { Id = id, request.PaymentChannel }, transaction, cancellationToken: ct));
        await transaction.CommitAsync(ct);
    }

    private sealed record CartProduct(Guid Id, string Name, decimal Price, int? Stock, Guid SalonId);
    private sealed record OrderRow(Guid Id, string CustomerName, string CustomerPhone, string CustomerEmail,
        string PaymentMethod, string PaymentStatus, string Status, DateTime CreatedAt, DateTime? DeliveredAt);
    private sealed record ItemRow(Guid OrderId, Guid ProductId, string ProductName, int Quantity, decimal UnitPrice);
}

internal sealed class StoreOrderException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

// carrito y contacto
public sealed record CreateCartOrderRequest(
    IReadOnlyList<CartOrderItemRequest> Items, string CustomerName, string CustomerPhone,
    string CustomerEmail, string PaymentMethod);
// producto y cantidad
public sealed record CartOrderItemRequest(Guid ProductId, int Quantity);
// accion sobre pedido
public sealed record UpdateProductOrderRequest(string Action, string? PaymentChannel = null);
// pedido creado
public sealed record CreatedCartOrderResponse(
    Guid Id, string ProductName, string PaymentStatus, string Status, decimal Amount, string? CheckoutUrl,
    IReadOnlyList<ProductOrderItemResponse> Items);
// item del pedido
public sealed record ProductOrderItemResponse(Guid ProductId, string ProductName, int Quantity, decimal UnitPrice);
// pedido
public sealed record ProductOrderResponse(
    Guid Id, string CustomerName, string CustomerPhone, string CustomerEmail,
    string PaymentMethod, string PaymentStatus, string Status, DateTimeOffset CreatedAt,
    DateTimeOffset? DeliveredAt, decimal Amount, IReadOnlyList<ProductOrderItemResponse> Items);
