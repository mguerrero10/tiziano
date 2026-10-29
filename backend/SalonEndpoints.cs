using System.Data;
using System.Security.Claims;
using Dapper;
using Npgsql;
using StudentHub.Api.Data;

namespace StudentHub.Api;

public static partial class SalonEndpoints
{
    private const int MaxHairPreviewsPerAppointment = 2;
    private const int MaxProductCategoryLength = 60;

    public static IEndpointRouteBuilder MapSalonEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/dashboard", GetDashboard).RequireAuthorization();
        app.MapGet("/api/services", GetServices).RequireAuthorization();
        app.MapPatch("/api/services/{id:guid}", UpdateService).RequireAuthorization();
        app.MapGet("/api/customers", GetCustomers).RequireAuthorization();
        app.MapGet("/api/staff", GetStaff).RequireAuthorization();
        app.MapPost("/api/staff", CreateStaff).RequireAuthorization();
        app.MapPatch("/api/staff/{id:guid}", UpdateStaff).RequireAuthorization();
        app.MapGet("/api/appointments", GetAppointments).RequireAuthorization();
        app.MapPatch("/api/appointments/{id:guid}/payment", RecordAppointmentPayment)
            .RequireAuthorization()
            .WithSummary("Registrar un cobro presencial de un turno")
            .WithDescription("Guarda el medio concreto del pago del turno sin crear un movimiento financiero duplicado.")
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict);
        app.MapGet("/api/finance/transactions", GetFinanceTransactions)
            .RequireAuthorization()
            .WithSummary("Consultar ingresos y pagos pendientes")
            .WithDescription("Lista en un solo historial los pagos de turnos y pedidos de tienda, con filtros por período, origen, estado y medio de pago.")
            .Produces<IReadOnlyList<FinanceTransactionResponse>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound);
        app.MapPatch("/api/salon/logo", UpdateSalonLogo).RequireAuthorization();
        app.MapPatch("/api/salon/store", UpdateSalonStore).RequireAuthorization();
        app.MapGet("/api/products", GetProducts).RequireAuthorization();
        app.MapPost("/api/products", CreateProduct).RequireAuthorization();
        app.MapPatch("/api/products/{id:guid}", UpdateProduct).RequireAuthorization();
        app.MapDelete("/api/products/{id:guid}", DeleteProduct).RequireAuthorization();

        app.MapGet("/api/public/salons/{slug}", GetPublicSalon);
        app.MapGet("/api/public/salons/{slug}/store", GetPublicStore);
        app.MapPost("/api/public/salons/{slug}/store/orders", CreateCartOrder)
            .RequireRateLimiting("public-booking");
        app.MapGet("/api/product-orders", GetProductOrders).RequireAuthorization()
            .WithSummary("Historial de pedidos del salón");
        app.MapPatch("/api/product-orders/{id:guid}", UpdateProductOrder).RequireAuthorization()
            .WithSummary("Registrar cobro, entrega o cancelación de un pedido");
        app.MapGet("/api/public/salons/{slug}/store/orders/{id:guid}", SyncProductOrderPayment);
        app.MapPost("/api/public/salons/{slug}/store/orders/{id:guid}/payment/demo", SimulateTestProductOrderPayment)
            .RequireRateLimiting("public-booking");
        app.MapGet("/api/public/salons/{slug}/availability", GetAvailability);
        app.MapGet("/api/public/hair-styles", GetHairStyles);
        app.MapPost("/api/public/salons/{slug}/appointments", CreateAppointment)
            .RequireRateLimiting("public-booking");
        app.MapGet("/api/public/salons/{slug}/appointments/{id:guid}/payment", SyncAppointmentPayment);
        app.MapPost("/api/public/salons/{slug}/appointments/{id:guid}/payment/demo", SimulateTestPayment)
            .RequireRateLimiting("public-booking");
        app.MapGet("/api/public/payments/mercadopago/webhook", MercadoPagoWebhookPing);
        app.MapPost("/api/public/payments/mercadopago/webhook", HandleMercadoPagoWebhook);
        app.MapPost("/api/public/salons/{slug}/hair-preview", GenerateHairPreview)
            .RequireRateLimiting("hair-preview");

        return app;
    }

    private static async Task<IResult> GetHairStyles(
        YouCamStyleCache youCamStyles,
        CancellationToken cancellationToken)
    {
        if (!youCamStyles.IsConfigured)
        {
            return Results.Json(
                new { message = "no olvidar YOUCAM_API_KEY." },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var styles = await youCamStyles.GetStylesAsync(cancellationToken);
        return Results.Ok(styles.Select(style => new
        {
            id = style.Id,
            name = style.Name,
            group = style.Group,
            thumbUrl = style.ThumbUrl,
            category = style.Category,
        }));
    }

    private static async Task<IResult> GenerateHairPreview(
        string slug,
        HairPreviewRequest request,
        HairPreviewService hairPreview,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!hairPreview.IsConfigured)
        {
            return Results.Json(
                new { message = "no olvidar YOUCAM_API_KEY." },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        if (request.AppointmentId == Guid.Empty)
        {
            return Results.Json(
                new { message = "se puede generar la vista previa si hubo confirmacion de turno" },
                statusCode: StatusCodes.Status403Forbidden);
        }

        if (string.IsNullOrWhiteSpace(request.ImageBase64))
        {
            return Results.BadRequest(new { message = "Subí una selfie." });
        }

        var hasCustomReference = !string.IsNullOrWhiteSpace(request.ReferenceImageBase64);
        if (!hasCustomReference && request.StyleId <= 0)
        {
            return Results.BadRequest(new { message = "Elegí un estilo del catálogo o subí una foto de referencia del corte." });
        }

        var mimeType = string.IsNullOrWhiteSpace(request.MimeType) ? "image/jpeg" : request.MimeType.Trim();
        if (mimeType is not ("image/jpeg" or "image/png" or "image/webp"))
        {
            return Results.BadRequest(new { message = "Formato de imagen no soportado." });
        }

        var imageBase64 = request.ImageBase64.Trim();
        if (imageBase64.Contains(','))
        {
            imageBase64 = imageBase64.Split(',', 2)[1];
        }

        // 7 millones de caracteres Base64 son masomenos 5MB
        if (imageBase64.Length > 7_000_000)
        {
            return Results.BadRequest(new { message = "La imagen es demasiado grande, como max 5mb." });
        }

        string? referenceImageBase64 = null;
        string? referenceMimeType = null;
        if (hasCustomReference)
        {
            referenceImageBase64 = request.ReferenceImageBase64!.Trim();
            if (referenceImageBase64.Contains(','))
            {
                referenceImageBase64 = referenceImageBase64.Split(',', 2)[1];
            }

            if (referenceImageBase64.Length > 7_000_000)
            {
                return Results.BadRequest(new { message = "La imagen es demasiado grande, como max 5mb." });
            }

            referenceMimeType = string.IsNullOrWhiteSpace(request.ReferenceMimeType)
                ? "image/jpeg"
                : request.ReferenceMimeType.Trim();
            if (referenceMimeType is not ("image/jpeg" or "image/png" or "image/webp"))
            {
                return Results.BadRequest(new { message = "Formato de imagen no soportado." });
            }
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var booking = await connection.QuerySingleOrDefaultAsync<HairPreviewBooking>(
            new CommandDefinition(
                """
                select a.id as "AppointmentId",
                       a.hair_preview_count as "HairPreviewCount",
                       sv.module_key as "ModuleKey"
                from public.appointments a
                join public.salons s on s.id = a.salon_id
                join public.services sv on sv.id = a.service_id
                where a.id = @AppointmentId
                  and s.slug = @Slug
                  and s.active
                  and a.status in ('pending', 'confirmed')
                  and a.created_at >= now() - interval '2 hours'
                """,
                new { request.AppointmentId, Slug = slug },
                cancellationToken: cancellationToken));

        if (booking is null || booking.ModuleKey != "hair")
        {
            return Results.Json(
                new { message = "se puede generar la vista previa si hubo confirmacion de turno" },
                statusCode: StatusCodes.Status403Forbidden);
        }

        if (booking.HairPreviewCount >= MaxHairPreviewsPerAppointment)
        {
            return Results.Json(
                new { message = "Ya usaste todas las vistas previas" },
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        var detalle = NullIfEmpty(request.StyleNotes);

        var consumedCount = await connection.ExecuteScalarAsync<int?>(
            new CommandDefinition(
                """
                update public.appointments
                set hair_preview_count = hair_preview_count + 1,
                    detalle = @Detalle
                where id = @AppointmentId
                  and hair_preview_count < @MaxCount
                returning hair_preview_count
                """,
                new
                {
                    request.AppointmentId,
                    MaxCount = MaxHairPreviewsPerAppointment,
                    Detalle = detalle,
                },
                cancellationToken: cancellationToken));

        if (consumedCount is null)
        {
            return Results.Json(
                new { message = "Ya usaste todas las vistas previas" },
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        try
        {
            var preview = await hairPreview.GenerateAsync(
                request with
                {
                    ImageBase64 = imageBase64,
                    MimeType = mimeType,
                    ReferenceImageBase64 = referenceImageBase64,
                    ReferenceMimeType = referenceMimeType,
                },
                cancellationToken);
            return Results.Ok(new
            {
                mimeType = preview.MimeType,
                imageBase64 = preview.ImageBase64,
                provider = preview.Provider,
                customReference = preview.Provider == "youcam-custom",
                remainingPreviews = MaxHairPreviewsPerAppointment - consumedCount.Value,
            });
        }
        catch (ArgumentException exception)
        {
            await ReleaseHairPreviewUseAsync(connection, request.AppointmentId, cancellationToken);
            return Results.BadRequest(new { message = exception.Message });
        }
        catch (Exception exception)
        {
            await ReleaseHairPreviewUseAsync(connection, request.AppointmentId, cancellationToken);
            return Results.BadRequest(new { message = exception.Message });
        }
    }

    private static Task<int> ReleaseHairPreviewUseAsync(
        NpgsqlConnection connection,
        Guid appointmentId,
        CancellationToken cancellationToken) =>
        connection.ExecuteAsync(
            new CommandDefinition(
                """
                update public.appointments
                set hair_preview_count = greatest(hair_preview_count - 1, 0)
                where id = @AppointmentId
                """,
                new { AppointmentId = appointmentId },
                cancellationToken: cancellationToken));

    private static async Task<IResult> GetDashboard(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);

        const string sql = """
            select
              (
                select count(*)::int
                from public.appointments a
                where a.salon_id = s.id
                  and (a.starts_at at time zone s.timezone)::date =
                      (now() at time zone s.timezone)::date
                  and a.status in ('pending', 'confirmed')
              ) as "Today",
              (
                select count(*)::int
                from public.appointments a
                where a.salon_id = s.id
                  and a.starts_at >= now()
                  and a.status in ('pending', 'confirmed')
              ) as "Upcoming",
              (
                select count(*)::int
                from public.customers c
                where c.salon_id = s.id
              ) as "Customers",
              (
                select count(*)::int
                from public.appointments a
                where a.salon_id = s.id
                  and a.status in ('confirmed', 'completed')
                  and a.starts_at <= now()
                  and a.starts_at >= now() - interval '30 days'
              ) as "Visits"
            from public.salons s
            where s.id = @SalonId;

            select a.id as "Id", a.starts_at as "StartsAt", a.ends_at as "EndsAt",
                   a.status as "Status", c.name as "CustomerName", c.phone as "CustomerPhone",
                   sv.name as "ServiceName", st.display_name as "StaffName",
                   a.detalle as "Detalle", a.notes as "Notes",
                   a.payment_method as "PaymentMethod", a.payment_status as "PaymentStatus"
            from public.appointments a
            join public.customers c on c.id = a.customer_id
            join public.services sv on sv.id = a.service_id
            join public.staff st on st.id = a.staff_id
            where a.salon_id = @SalonId
              and a.starts_at >= now() - interval '2 hours'
              and a.status in ('pending', 'confirmed')
            order by a.starts_at
            limit 12;

            select c.name as "Name",
                   count(*)::int as "Visits",
                   max(a.starts_at) as "LastVisitAt"
            from public.appointments a
            join public.customers c on c.id = a.customer_id
            where a.salon_id = @SalonId
              and a.status in ('confirmed', 'completed')
              and a.starts_at <= now()
              and a.starts_at >= now() - interval '90 days'
            group by c.id, c.name
            order by count(*) desc, max(a.starts_at) desc
            limit 6;

            select to_char(d.day::date, 'YYYY-MM-DD') as "Day",
                   count(a.id)::int as "Count"
            from generate_series(
                   ((now() at time zone @Timezone)::date - 13),
                   (now() at time zone @Timezone)::date,
                   interval '1 day'
                 ) as d(day)
            left join public.appointments a
              on a.salon_id = @SalonId
             and (a.starts_at at time zone @Timezone)::date = d.day::date
             and a.status <> 'cancelled'
            group by d.day
            order by d.day;

            select sv.name as "Name", count(*)::int as "Count"
            from public.appointments a
            join public.services sv on sv.id = a.service_id
            where a.salon_id = @SalonId
              and a.status <> 'cancelled'
              and a.starts_at >= now() - interval '30 days'
            group by sv.id, sv.name
            order by count(*) desc, sv.name
            limit 6;

            select extract(hour from a.starts_at at time zone @Timezone)::int as "Hour",
                   count(*)::int as "Count"
            from public.appointments a
            where a.salon_id = @SalonId
              and a.status <> 'cancelled'
              and a.starts_at >= now() - interval '30 days'
            group by 1
            order by 1;

            select st.display_name as "Name", count(a.id)::int as "Count"
            from public.staff st
            join public.appointments a
              on a.staff_id = st.id
             and a.status <> 'cancelled'
             and a.starts_at >= now() - interval '30 days'
            where st.salon_id = @SalonId
            group by st.id, st.display_name
            order by count(a.id) desc, st.display_name
            limit 6;
            """;

        var salon = await connection.QuerySingleOrDefaultAsync<SalonSummary>(
            new CommandDefinition(
                """
                select s.id as "Id", s.name as "Name", s.slug as "Slug", s.timezone as "Timezone",
                       sm.role as "Role"
                from public.salon_members sm
                join public.salons s on s.id = sm.salon_id
                where sm.user_id = @UserId and s.active
                order by sm.created_at
                limit 1
                """,
                new { UserId = userId },
                cancellationToken: cancellationToken));

        if (salon is null)
        {
            return Results.NotFound(new { message = "Tu usuario todavía no pertenece a una peluquería." });
        }

        DashboardStats stats;
        List<AppointmentListItem> appointments;
        List<DashboardCustomerPoint> topCustomers;
        List<DashboardDayPoint> appointmentsByDay;
        List<DashboardRankPoint> topServices;
        List<DashboardHourPoint> busyHours;
        List<DashboardRankPoint> topStaff;
        using (var result = await connection.QueryMultipleAsync(
            new CommandDefinition(
                sql,
                new { SalonId = salon.Id, Timezone = salon.Timezone },
                cancellationToken: cancellationToken)))
        {
            stats = await result.ReadSingleAsync<DashboardStats>();
            appointments = (await result.ReadAsync<AppointmentListItem>()).AsList();
            topCustomers = (await result.ReadAsync<DashboardCustomerPoint>()).AsList();
            appointmentsByDay = (await result.ReadAsync<DashboardDayPoint>()).AsList();
            topServices = (await result.ReadAsync<DashboardRankPoint>()).AsList();
            busyHours = FillBusyHours((await result.ReadAsync<DashboardHourPoint>()).AsList());
            topStaff = (await result.ReadAsync<DashboardRankPoint>()).AsList();
        }

        var topProducts = await ReadTopProductsAsync(connection, salon.Id, cancellationToken);
        var modules = (await connection.QueryAsync<SalonModuleItem>(
            new CommandDefinition(
                """
                select pm.key as "Key", pm.name as "Name"
                from public.salon_modules sm
                join public.platform_modules pm on pm.key = sm.module_key
                where sm.salon_id = @SalonId and sm.enabled and pm.active
                order by pm.sort_order
                """,
                new { SalonId = salon.Id },
                cancellationToken: cancellationToken))).AsList();
        return Results.Ok(new
        {
            salon,
            stats,
            appointments,
            modules,
            insights = new
            {
                topCustomers,
                appointmentsByDay,
                topServices,
                busyHours,
                topStaff,
                topProducts,
            }
        });
    }

    private static async Task<IResult> GetServices(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var services = await connection.QueryAsync<ServiceItem>(
            new CommandDefinition(
                """
                select sv.id as "Id", sv.name as "Name", sv.description as "Description",
                       sv.duration_minutes as "DurationMinutes", sv.price as "Price", sv.active as "Active",
                       sv.module_key as "ModuleKey"
                from public.services sv
                left join public.platform_service_catalog psc
                  on psc.module_key = sv.module_key and psc.key = sv.catalog_key
                where sv.salon_id = @SalonId
                  and sv.module_key in (
                    select sm.module_key
                    from public.salon_modules sm
                    join public.platform_modules pm on pm.key = sm.module_key
                    where sm.salon_id = @SalonId and sm.enabled and pm.active
                  )
                order by sv.module_key, coalesce(psc.sort_order, 999), sv.name
                """,
                new { SalonId = salonId },
                cancellationToken: cancellationToken));

        return Results.Ok(services);
    }

    private static async Task<IResult> GetProducts(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        if (!await SalonHasProductsModule(salonId.Value, db, cancellationToken))
        {
            return Results.Json(
                new { message = "El módulo de productos no está habilitado." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var products = await connection.QueryAsync<ProductItem>(
            new CommandDefinition(
                """
                select p.id as "Id", p.name as "Name", p.description as "Description",
                       p.price as "Price", p.image_url as "ImageUrl", p.active as "Active",
                       p.sort_order as "SortOrder", p.category as "Category", p.stock as "Stock",
                       p.brand as "Brand", p.size_ml as "SizeMl"
                from public.products p
                where p.salon_id = @SalonId
                order by p.sort_order, p.name
                """,
                new { SalonId = salonId },
                cancellationToken: cancellationToken));

        return Results.Ok(products);
    }

    private static async Task<IResult> CreateProduct(
        CreateProductRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        var name = NullIfEmpty(request.Name);
        if (name is null)
        {
            return Results.BadRequest(new { message = "Indicá el nombre del producto." });
        }

        if (request.Price is < 0)
        {
            return Results.BadRequest(new { message = "El precio no puede ser negativo." });
        }

        var category = NullIfEmpty(request.Category);
        if (category is { Length: > MaxProductCategoryLength })
        {
            return Results.BadRequest(new { message = $"La categoría puede tener hasta {MaxProductCategoryLength} caracteres." });
        }

        if (request.SizeMl is <= 0)
        {
            return Results.BadRequest(new { message = "El tamaño tiene que ser mayor a 0 ml." });
        }

        if (request.Stock is < 0)
        {
            return Results.BadRequest(new { message = "El stock no puede ser negativo." });
        }

        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        if (!await SalonHasProductsModule(salonId.Value, db, cancellationToken))
        {
            return Results.Json(
                new { message = "El módulo de productos no está habilitado." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        var imageUrl = NullIfEmpty(request.ImageUrl);
        if (imageUrl is not null && !IsOwnSalonProductImageUrl(imageUrl, salonId.Value))
        {
            return Results.BadRequest(new { message = "La imagen tiene que ser una foto subida para este salón." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var product = await connection.QuerySingleAsync<ProductItem>(
            new CommandDefinition(
                """
                insert into public.products
                  (salon_id, name, description, price, image_url, active, sort_order, category, stock, brand, size_ml)
                values (
                  @SalonId, @Name, @Description, @Price, @ImageUrl, coalesce(@Active, true),
                  coalesce(
                    (select max(sort_order) + 1 from public.products where salon_id = @SalonId),
                    0
                  ),
                  @Category, @Stock, @Brand, @SizeMl
                )
                returning id as "Id", name as "Name", description as "Description",
                          price as "Price", image_url as "ImageUrl", active as "Active",
                          sort_order as "SortOrder", category as "Category", stock as "Stock",
                          brand as "Brand", size_ml as "SizeMl"
                """,
                new
                {
                    SalonId = salonId,
                    Name = name,
                    Description = NullIfEmpty(request.Description),
                    Price = request.Price,
                    ImageUrl = imageUrl,
                    Active = request.Active,
                    Category = category,
                    request.Stock,
                    Brand = NullIfEmpty(request.Brand),
                    request.SizeMl,
                },
                cancellationToken: cancellationToken));

        return Results.Ok(product);
    }

    private static async Task<IResult> UpdateProduct(
        Guid id,
        UpdateProductRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (request.Name is null && request.Description is null && request.Price is null
            && request.ImageUrl is null && request.Active is null
            && request.Category is null && request.Stock is null && request.ClearStock is null
            && request.Brand is null && request.SizeMl is null && request.ClearSizeMl is null)
        {
            return Results.BadRequest(new { message = "Indicá qué querés actualizar." });
        }

        if (request.Price is < 0)
        {
            return Results.BadRequest(new { message = "El precio no puede ser negativo." });
        }

        var category = request.Category is null ? null : NullIfEmpty(request.Category);
        if (category is { Length: > MaxProductCategoryLength })
        {
            return Results.BadRequest(new { message = $"La categoría puede tener hasta {MaxProductCategoryLength} caracteres." });
        }

        if (request.SizeMl is <= 0)
        {
            return Results.BadRequest(new { message = "El tamaño tiene que ser mayor a 0 ml." });
        }

        if (request.Stock is < 0)
        {
            return Results.BadRequest(new { message = "El stock no puede ser negativo." });
        }

        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        if (!await SalonHasProductsModule(salonId.Value, db, cancellationToken))
        {
            return Results.Json(
                new { message = "El módulo de productos no está habilitado." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        string? imageUrl = request.ImageUrl;
        if (imageUrl is not null)
        {
            imageUrl = string.IsNullOrWhiteSpace(imageUrl) ? null : imageUrl.Trim();
            if (imageUrl is not null && !IsOwnSalonProductImageUrl(imageUrl, salonId.Value))
            {
                return Results.BadRequest(new { message = "La imagen tiene que ser una foto subida para este salón." });
            }
        }

        var name = request.Name is null ? null : NullIfEmpty(request.Name);
        if (request.Name is not null && name is null)
        {
            return Results.BadRequest(new { message = "Indicá el nombre del producto." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var product = await connection.QuerySingleOrDefaultAsync<ProductItem>(
            new CommandDefinition(
                """
                update public.products p
                set name = coalesce(@Name, p.name),
                    description = case when @DescriptionSet then @Description else p.description end,
                    price = coalesce(@Price, p.price),
                    image_url = case when @ImageUrlSet then @ImageUrl else p.image_url end,
                    active = coalesce(@Active, p.active),
                    category = case when @CategorySet then @Category else p.category end,
                    stock = case
                      when @ClearStock then null
                      when @Stock is not null then @Stock
                      else p.stock
                    end,
                    brand = case when @BrandSet then @Brand else p.brand end,
                    size_ml = case
                      when @ClearSizeMl then null
                      when @SizeMl is not null then @SizeMl
                      else p.size_ml
                    end,
                    updated_at = now()
                where p.id = @Id and p.salon_id = @SalonId
                returning p.id as "Id", p.name as "Name", p.description as "Description",
                          p.price as "Price", p.image_url as "ImageUrl", p.active as "Active",
                          p.sort_order as "SortOrder", p.category as "Category", p.stock as "Stock",
                          p.brand as "Brand", p.size_ml as "SizeMl"
                """,
                new
                {
                    Id = id,
                    SalonId = salonId,
                    Name = name,
                    DescriptionSet = request.Description is not null,
                    Description = NullIfEmpty(request.Description),
                    Price = request.Price,
                    ImageUrlSet = request.ImageUrl is not null,
                    ImageUrl = imageUrl,
                    Active = request.Active,
                    CategorySet = request.Category is not null,
                    Category = category,
                    request.Stock,
                    ClearStock = request.ClearStock == true,
                    BrandSet = request.Brand is not null,
                    Brand = request.Brand is null ? null : NullIfEmpty(request.Brand),
                    request.SizeMl,
                    ClearSizeMl = request.ClearSizeMl == true,
                },
                cancellationToken: cancellationToken));

        return product is null
            ? Results.NotFound(new { message = "Producto no encontrado." })
            : Results.Ok(product);
    }

    private static async Task<IResult> DeleteProduct(
        Guid id,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        if (!await SalonHasProductsModule(salonId.Value, db, cancellationToken))
        {
            return Results.Json(
                new { message = "El módulo de productos no está habilitado." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        await using var connection = (NpgsqlConnection)db.Create();
        int deleted;
        try
        {
            deleted = await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    delete from public.products
                    where id = @Id and salon_id = @SalonId
                    """,
                    new { Id = id, SalonId = salonId },
                    cancellationToken: cancellationToken));
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.ForeignKeyViolation)
        {
            loggerFactory.CreateLogger("ProductOrders").LogWarning(exception, "Producto {ProductId} incluido en pedidos", id);
            return Results.Conflict(new { message = "Este producto tiene pedidos. Desactivalo para ocultarlo sin borrar su historial." });
        }

        return deleted == 0
            ? Results.NotFound(new { message = "Producto no encontrado." })
            : Results.NoContent();
    }

    private static async Task<IResult> UpdateService(
        Guid id,
        UpdateServiceRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (request.Active is null && request.Price is null)
        {
            return Results.BadRequest(new { message = "Indicá el precio o si el servicio está activo." });
        }

        if (request.Price is < 0)
        {
            return Results.BadRequest(new { message = "El precio no puede ser negativo." });
        }

        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var service = await connection.QuerySingleOrDefaultAsync<ServiceItem>(
            new CommandDefinition(
                """
                update public.services sv
                set active = coalesce(@Active, sv.active),
                    price = coalesce(@Price, sv.price)
                where sv.id = @Id
                  and sv.salon_id = @SalonId
                  and sv.module_key in (
                    select sm.module_key
                    from public.salon_modules sm
                    join public.platform_modules pm on pm.key = sm.module_key
                    where sm.salon_id = @SalonId and sm.enabled and pm.active
                  )
                returning sv.id as "Id", sv.name as "Name", sv.description as "Description",
                          sv.duration_minutes as "DurationMinutes", sv.price as "Price",
                          sv.active as "Active", sv.module_key as "ModuleKey"
                """,
                new
                {
                    Id = id,
                    SalonId = salonId,
                    Active = request.Active,
                    Price = request.Price
                },
                cancellationToken: cancellationToken));

        if (service is null)
        {
            return Results.NotFound(new { message = "Servicio no encontrado." });
        }

        return Results.Ok(service);
    }

    private static async Task<IResult> GetCustomers(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var customers = await connection.QueryAsync<CustomerItem>(
            new CommandDefinition(
                """
                select c.id as "Id", c.name as "Name", c.phone as "Phone", c.email as "Email",
                       count(a.id)::int as "AppointmentCount",
                       max(a.starts_at) as "LastAppointmentAt"
                from public.customers c
                left join public.appointments a on a.customer_id = c.id
                where c.salon_id = @SalonId
                group by c.id
                order by max(a.starts_at) desc nulls last, c.name
                """,
                new { SalonId = salonId },
                cancellationToken: cancellationToken));

        return Results.Ok(customers);
    }

    private static async Task<IResult> GetStaff(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var staff = await connection.QueryAsync<StaffListItem>(
            new CommandDefinition(
                """
                select st.id as "Id",
                       st.display_name as "DisplayName",
                       st.active as "Active",
                       p.email as "Email",
                       coalesce(
                         string_agg(distinct sv.name, ', ' order by sv.name),
                         ''
                       ) as "ServiceNames"
                from public.staff st
                left join public.profiles p on p.id = st.user_id
                left join public.staff_services ss on ss.staff_id = st.id
                left join public.services sv on sv.id = ss.service_id and sv.active
                where st.salon_id = @SalonId
                group by st.id, st.display_name, st.active, p.email
                order by st.display_name
                """,
                new { SalonId = salonId },
                cancellationToken: cancellationToken));

        return Results.Ok(staff);
    }

    private static async Task<IResult> CreateStaff(
        CreateStaffRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        var displayName = NullIfEmpty(request.DisplayName);
        if (displayName is null)
        {
            return Results.BadRequest(new { message = "Indicá el nombre del profesional." });
        }

        if (displayName.Length > 80)
        {
            return Results.BadRequest(new { message = "El nombre puede tener hasta 80 caracteres." });
        }

        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        var serviceIds = (request.ServiceIds ?? []).Where(id => id != Guid.Empty).Distinct().ToArray();
        var serviceIdList = string.Join(',', serviceIds);

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        if (serviceIds.Length > 0)
        {
            var validCount = await connection.ExecuteScalarAsync<int>(
                new CommandDefinition(
                    """
                    select count(*)::int
                    from public.services
                    where salon_id = @SalonId
                      and id = any(string_to_array(@ServiceIds, ',')::uuid[])
                    """,
                    new { SalonId = salonId, ServiceIds = serviceIdList },
                    transaction,
                    cancellationToken: cancellationToken));

            if (validCount != serviceIds.Length)
            {
                return Results.BadRequest(new { message = "Alguno de los servicios no pertenece a este salón." });
            }
        }

        var duplicate = await connection.ExecuteScalarAsync<bool>(
            new CommandDefinition(
                """
                select exists (
                  select 1
                  from public.staff
                  where salon_id = @SalonId
                    and lower(display_name) = lower(@DisplayName)
                )
                """,
                new { SalonId = salonId, DisplayName = displayName },
                transaction,
                cancellationToken: cancellationToken));

        if (duplicate)
        {
            return Results.BadRequest(new { message = "Ya hay un profesional con ese nombre." });
        }

        Guid staffId;
        try
        {
            staffId = await connection.ExecuteScalarAsync<Guid>(
                new CommandDefinition(
                    """
                    insert into public.staff (salon_id, user_id, display_name)
                    values (@SalonId, null, @DisplayName)
                    returning id
                    """,
                    new { SalonId = salonId, DisplayName = displayName },
                    transaction,
                    cancellationToken: cancellationToken));
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Results.BadRequest(new { message = "No se pudo agregar el profesional. Probá con otro nombre." });
        }

        if (serviceIds.Length > 0)
        {
            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    insert into public.staff_services (staff_id, service_id)
                    select @StaffId, sv.id
                    from public.services sv
                    where sv.salon_id = @SalonId
                      and sv.id = any(string_to_array(@ServiceIds, ',')::uuid[])
                    on conflict do nothing
                    """,
                    new { StaffId = staffId, SalonId = salonId, ServiceIds = serviceIdList },
                    transaction,
                    cancellationToken: cancellationToken));
        }

        var created = await connection.QuerySingleAsync<StaffListItem>(
            new CommandDefinition(
                """
                select st.id as "Id",
                       st.display_name as "DisplayName",
                       st.active as "Active",
                       p.email as "Email",
                       coalesce(
                         string_agg(distinct sv.name, ', ' order by sv.name),
                         ''
                       ) as "ServiceNames"
                from public.staff st
                left join public.profiles p on p.id = st.user_id
                left join public.staff_services ss on ss.staff_id = st.id
                left join public.services sv on sv.id = ss.service_id and sv.active
                where st.id = @Id and st.salon_id = @SalonId
                group by st.id, st.display_name, st.active, p.email
                """,
                new { Id = staffId, SalonId = salonId },
                transaction,
                cancellationToken: cancellationToken));

        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(created);
    }

    private static async Task<IResult> UpdateStaff(
        Guid id,
        UpdateStaffRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (request.Active is null)
        {
            return Results.BadRequest(new { message = "Indicá qué querés actualizar." });
        }

        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        var current = await connection.QuerySingleOrDefaultAsync<BoolValue>(
            new CommandDefinition(
                """
                select active as "Value"
                from public.staff
                where id = @Id and salon_id = @SalonId
                for update
                """,
                new { Id = id, SalonId = salonId },
                transaction,
                cancellationToken: cancellationToken));

        if (current is null)
        {
            return Results.NotFound(new { message = "Profesional no encontrado." });
        }

        if (!request.Active.Value && current.Value)
        {
            var otherActive = await connection.ExecuteScalarAsync<bool>(
                new CommandDefinition(
                    """
                    select exists (
                      select 1 from public.staff
                      where salon_id = @SalonId and active and id <> @Id
                    )
                    """,
                    new { Id = id, SalonId = salonId },
                    transaction,
                    cancellationToken: cancellationToken));

            if (!otherActive)
            {
                return Results.BadRequest(new { message = "Tiene que quedar al menos un profesional activo." });
            }
        }

        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                update public.staff
                set active = @Active
                where id = @Id and salon_id = @SalonId
                """,
                new { Id = id, SalonId = salonId, Active = request.Active.Value },
                transaction,
                cancellationToken: cancellationToken));

        var updated = await connection.QuerySingleAsync<StaffListItem>(
            new CommandDefinition(
                """
                select st.id as "Id",
                       st.display_name as "DisplayName",
                       st.active as "Active",
                       p.email as "Email",
                       coalesce(
                         string_agg(distinct sv.name, ', ' order by sv.name),
                         ''
                       ) as "ServiceNames"
                from public.staff st
                left join public.profiles p on p.id = st.user_id
                left join public.staff_services ss on ss.staff_id = st.id
                left join public.services sv on sv.id = ss.service_id and sv.active
                where st.id = @Id and st.salon_id = @SalonId
                group by st.id, st.display_name, st.active, p.email
                """,
                new { Id = id, SalonId = salonId },
                transaction,
                cancellationToken: cancellationToken));

        await transaction.CommitAsync(cancellationToken);
        return Results.Ok(updated);
    }

    private static async Task<IResult> GetAppointments(
        ClaimsPrincipal user,
        DateOnly from,
        DateOnly to,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);

        var timezone = await connection.ExecuteScalarAsync<string>(
            new CommandDefinition(
                "select timezone from public.salons where id = @SalonId",
                new { SalonId = salonId },
                cancellationToken: cancellationToken)) ?? "UTC";

        var zone = ResolveTimeZone(timezone);
        var rangeStart = ToUtc(from, TimeOnly.MinValue, zone);
        var rangeEnd = ToUtc(to.AddDays(1), TimeOnly.MinValue, zone);

        var appointments = await connection.QueryAsync<AppointmentListItem>(
            new CommandDefinition(
                """
                select a.id as "Id", a.starts_at as "StartsAt", a.ends_at as "EndsAt",
                       a.status as "Status", c.name as "CustomerName", c.phone as "CustomerPhone",
                       sv.name as "ServiceName", st.display_name as "StaffName",
                       a.detalle as "Detalle", a.notes as "Notes",
                       a.payment_method as "PaymentMethod", a.payment_status as "PaymentStatus"
                from public.appointments a
                join public.customers c on c.id = a.customer_id
                join public.services sv on sv.id = a.service_id
                join public.staff st on st.id = a.staff_id
                where a.salon_id = @SalonId
                  and a.starts_at >= @RangeStart and a.starts_at < @RangeEnd
                order by a.starts_at
                """,
                new { SalonId = salonId, RangeStart = rangeStart, RangeEnd = rangeEnd },
                cancellationToken: cancellationToken));

        return Results.Ok(new { timezone, appointments });
    }

    private static async Task<IResult> GetPublicSalon(
        string slug,
        IDbConnectionFactory db,
        MercadoPagoService mercadoPago,
        CancellationToken cancellationToken)
    {
        await using var connection = (NpgsqlConnection)db.Create();
        var includeStoreColumn = true;
        while (true)
        {
            try
            {
                return await ReadPublicSalonAsync(
                    connection,
                    slug,
                    mercadoPago,
                    includeStoreColumn,
                    cancellationToken);
            }
            catch (PostgresException exception) when (includeStoreColumn && exception.SqlState == PostgresErrorCodes.UndefinedColumn)
            {
                includeStoreColumn = false;
            }
        }
    }

    private static async Task<IResult> ReadPublicSalonAsync(
        NpgsqlConnection connection,
        string slug,
        MercadoPagoService mercadoPago,
        bool includeStoreColumn,
        CancellationToken cancellationToken)
    {
        var storeSelect = includeStoreColumn
            ? "store_enabled as \"StoreEnabled\""
            : "true as \"StoreEnabled\"";
        var sql = $"""
            select id as "Id", name as "Name", slug as "Slug", timezone as "Timezone",
                   phone as "Phone", address as "Address", logo_url as "LogoUrl",
                   {storeSelect}
            from public.salons
            where slug = @Slug and active;

            select exists (
              select 1
              from public.salon_modules sm
              join public.salons s on s.id = sm.salon_id
              join public.platform_modules pm on pm.key = sm.module_key
              where s.slug = @Slug and s.active
                and sm.module_key = 'products' and sm.enabled and pm.active
            ) as "Value";

            select pm.key as "Key", pm.name as "Name"
            from public.salon_modules sm
            join public.platform_modules pm on pm.key = sm.module_key
            join public.salons s on s.id = sm.salon_id
            where s.slug = @Slug and s.active and sm.enabled and pm.active
              and pm.key in ('hair', 'spa', 'nails', 'lashes')
            order by pm.sort_order;

            select sv.id as "Id", sv.name as "Name", sv.description as "Description",
                   sv.duration_minutes as "DurationMinutes", sv.price as "Price",
                   sv.module_key as "ModuleKey", sv.catalog_key as "CatalogKey"
            from public.services sv
            join public.salons s on s.id = sv.salon_id
            left join public.platform_service_catalog psc
              on psc.module_key = sv.module_key and psc.key = sv.catalog_key
            where s.slug = @Slug and s.active and sv.active
              and sv.module_key in (
                select sm.module_key
                from public.salon_modules sm
                join public.platform_modules pm on pm.key = sm.module_key
                where sm.salon_id = s.id and sm.enabled and pm.active
              )
            order by coalesce(psc.sort_order, 999), sv.name;

            select st.id as "Id", st.display_name as "DisplayName",
                   ss.service_id as "ServiceId"
            from public.staff st
            join public.salons s on s.id = st.salon_id
            join public.staff_services ss on ss.staff_id = st.id
            join public.services sv on sv.id = ss.service_id and sv.active
            where s.slug = @Slug and s.active and st.active
            order by st.display_name;
            """;

        using var result = await connection.QueryMultipleAsync(
            new CommandDefinition(sql, new { Slug = slug }, cancellationToken: cancellationToken));
        var salon = await result.ReadSingleOrDefaultAsync<PublicSalon>();
        if (salon is null)
        {
            return Results.NotFound(new { message = "Peluquería no encontrada." });
        }

        var hasProductsModule = await result.ReadSingleAsync<BoolValue>();
        var modules = (await result.ReadAsync<PublicModuleItem>()).AsList();
        var services = (await result.ReadAsync<PublicServiceItem>()).AsList();
        var staffRows = (await result.ReadAsync<StaffServiceRow>()).AsList();
        var staff = staffRows
            .GroupBy(row => new { row.Id, row.DisplayName })
            .Select(group => new PublicStaff(
                group.Key.Id,
                group.Key.DisplayName,
                group.Select(row => row.ServiceId).Distinct().ToArray()))
            .ToArray();

        var modulesWithServices = modules
            .Where(module => services.Any(service => service.ModuleKey == module.Key))
            .ToArray();

        return Results.Ok(new
        {
            salon,
            modules = modulesWithServices,
            services,
            staff,
            store = new
            {
                enabled = salon.StoreEnabled && hasProductsModule.Value,
                moduleActive = hasProductsModule.Value,
            },
            payments = new
            {
                mercadoPago = mercadoPago.IsConfigured,
                testMode = mercadoPago.IsTestCredentials,
            },
        });
    }

    private static async Task<IResult> GetPublicStore(
        string slug,
        IDbConnectionFactory db,
        MercadoPagoService mercadoPago,
        CancellationToken cancellationToken)
    {
        await using var connection = (NpgsqlConnection)db.Create();
        const string sql = """
            select s.name as "Name", s.logo_url as "LogoUrl", s.store_enabled as "StoreEnabled"
            from public.salons s
            where s.slug = @Slug and s.active;

            select exists (
              select 1
              from public.salon_modules sm
              join public.salons s on s.id = sm.salon_id
              join public.platform_modules pm on pm.key = sm.module_key
              where s.slug = @Slug and s.active
                and sm.module_key = 'products' and sm.enabled and pm.active
            ) as "Value";

            select p.id as "Id", p.name as "Name", p.description as "Description",
                   p.price as "Price", p.image_url as "ImageUrl", p.category as "Category",
                   p.brand as "Brand", p.size_ml as "SizeMl",
                   (
                     p.stock is null
                     or p.stock - (
                       select coalesce(sum(i.quantity), 0)
                       from public.product_orders o
                       join public.product_order_items i on i.order_id = o.id
                       where i.product_id = p.id
                         and o.status = 'pending'
                         and o.payment_status = 'pending'
                         and (o.payment_expires_at is null or o.payment_expires_at > now())
                     ) > 0
                   ) as "InStock"
            from public.products p
            join public.salons s on s.id = p.salon_id
            where s.slug = @Slug and s.active and s.store_enabled and p.active
              and exists (
                select 1
                from public.salon_modules sm
                join public.platform_modules pm on pm.key = sm.module_key
                where sm.salon_id = s.id
                  and sm.module_key = 'products' and sm.enabled and pm.active
              )
            order by p.sort_order, p.name;
            """;

        using var result = await connection.QueryMultipleAsync(
            new CommandDefinition(sql, new { Slug = slug }, cancellationToken: cancellationToken));
        var salon = await result.ReadSingleOrDefaultAsync<PublicStoreSalon>();
        if (salon is null)
        {
            return Results.NotFound(new { message = "Peluquería no encontrada." });
        }

        var hasProductsModule = await result.ReadSingleAsync<BoolValue>();
        if (!salon.StoreEnabled || !hasProductsModule.Value)
        {
            return Results.NotFound(new { message = "La tienda no está disponible." });
        }

        var products = (await result.ReadAsync<PublicProductItem>()).AsList();
        return Results.Ok(new
        {
            salon = new { salon.Name, salon.LogoUrl },
            products,
            payments = new
            {
                mercadoPago = mercadoPago.IsConfigured,
                testMode = mercadoPago.IsTestCredentials,
            },
        });
    }

    private static async Task<IResult> SyncProductOrderPayment(
        string slug,
        Guid id,
        string? paymentId,
        IDbConnectionFactory db,
        MercadoPagoService mercadoPago,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        await ExpireStalePaymentsAsync(connection, null, cancellationToken);

        var method = await connection.QuerySingleOrDefaultAsync<string>(new CommandDefinition(
            """
            select o.payment_method from public.product_orders o
            join public.salons s on s.id = o.salon_id
            where o.id = @Id and s.slug = @Slug and s.active
              and o.created_at >= now() - interval '24 hours'
            """, new { Id = id, Slug = slug }, cancellationToken: cancellationToken));
        if (method is null) return Results.NotFound(new { message = "No encontramos ese pedido." });

        if (mercadoPago.IsConfigured && method == "mercadopago")
        {
            await ApplyMercadoPagoPaymentAsync(
                connection,
                mercadoPago,
                whatsApp: null,
                paymentId,
                appointmentId: null,
                productOrderId: id,
                loggerFactory.CreateLogger("ProductOrders"),
                cancellationToken);
        }

        var order = await connection.QuerySingleOrDefaultAsync<PublicProductOrder>(
            new CommandDefinition(
                """
                select o.id as "Id",
                       (select string_agg(i.product_name || ' × ' || i.quantity, ', ' order by i.product_name)
                        from public.product_order_items i where i.order_id = o.id) as "ProductName",
                       o.payment_status as "PaymentStatus", o.status as "Status",
                       (select sum(i.unit_price * i.quantity)
                        from public.product_order_items i where i.order_id = o.id) as "Amount"
                from public.product_orders o
                join public.salons s on s.id = o.salon_id
                where o.id = @Id and s.slug = @Slug and s.active
                  and o.created_at >= now() - interval '24 hours'
                """,
                new { Id = id, Slug = slug },
                cancellationToken: cancellationToken));

        return order is null
            ? Results.NotFound(new { message = "No encontramos ese pedido." })
            : Results.Ok(new
            {
                order.Id, order.ProductName, order.PaymentStatus, order.Status, order.Amount,
                Items = await GetPublicOrderItems(id, connection, cancellationToken)
            });
    }

    private static async Task<IResult> SimulateTestProductOrderPayment(
        string slug,
        Guid id,
        MercadoPagoService mercadoPago,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!mercadoPago.IsTestCredentials)
        {
            return Results.Json(
                new { message = "La simulación de pago solo está disponible con credenciales de prueba." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);

        var updated = await connection.ExecuteAsync(
            new CommandDefinition(
                """
                update public.product_orders o
                set status = 'confirmed',
                    payment_status = 'paid',
                    payment_channel = 'mercadopago',
                    paid_at = coalesce(o.paid_at, now()),
                    mp_payment_id = coalesce(o.mp_payment_id, 'demo-' || o.id::text)
                from public.salons s
                where o.id = @Id
                  and s.id = o.salon_id
                  and s.slug = @Slug
                  and s.active
                  and o.payment_method = 'mercadopago'
                  and o.payment_status = 'pending'
                  and o.status = 'pending'
                  and o.payment_expires_at > now()
                  and o.created_at >= now() - interval '24 hours'
                """,
                new { Id = id, Slug = slug },
                cancellationToken: cancellationToken));

        if (updated == 0)
        {
            return Results.BadRequest(new { message = "No hay un pago de prueba pendiente para este pedido." });
        }

        var order = await connection.QuerySingleOrDefaultAsync<PublicProductOrder>(
            new CommandDefinition(
                """
                select o.id as "Id",
                       (select string_agg(i.product_name || ' × ' || i.quantity, ', ' order by i.product_name)
                        from public.product_order_items i where i.order_id = o.id) as "ProductName",
                       o.payment_status as "PaymentStatus", o.status as "Status",
                       (select sum(i.unit_price * i.quantity)
                        from public.product_order_items i where i.order_id = o.id) as "Amount"
                from public.product_orders o
                join public.salons s on s.id = o.salon_id
                where o.id = @Id and s.slug = @Slug
                """,
                new { Id = id, Slug = slug },
                cancellationToken: cancellationToken));

        return order is null
            ? Results.NotFound(new { message = "No encontramos ese pedido." })
            : Results.Ok(new
            {
                order.Id, order.ProductName, order.PaymentStatus, order.Status, order.Amount,
                Items = await GetPublicOrderItems(id, connection, cancellationToken)
            });
    }

    private static async Task<IReadOnlyList<ProductOrderItemResponse>> GetPublicOrderItems(
        Guid orderId, System.Data.IDbConnection connection, CancellationToken cancellationToken)
    {
        return (await connection.QueryAsync<ProductOrderItemResponse>(new CommandDefinition(
            """
            select product_id as "ProductId", product_name as "ProductName",
                   quantity as "Quantity", unit_price as "UnitPrice"
            from public.product_order_items
            where order_id = @OrderId
            order by product_name, product_id
            """,
            new { OrderId = orderId }, cancellationToken: cancellationToken))).AsList();
    }

    private static async Task<IResult> GetAvailability(
        string slug,
        Guid serviceId,
        DateOnly date,
        Guid? staffId,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        await ExpireStalePaymentsAsync(connection, null, cancellationToken);

        var setup = await connection.QuerySingleOrDefaultAsync<AvailabilitySetup>(
            new CommandDefinition(
                """
                select s.id as "SalonId", s.timezone as "Timezone",
                       sv.duration_minutes as "DurationMinutes",
                       bh.opens_at as "OpensAt", bh.closes_at as "ClosesAt"
                from public.salons s
                join public.services sv on sv.salon_id = s.id and sv.id = @ServiceId and sv.active
                left join public.business_hours bh
                  on bh.salon_id = s.id and bh.weekday = @Weekday
                where s.slug = @Slug and s.active
                """,
                new { Slug = slug, ServiceId = serviceId, Weekday = (int)date.DayOfWeek },
                cancellationToken: cancellationToken));

        if (setup is null)
        {
            return Results.NotFound(new { message = "Servicio o peluquería no encontrados." });
        }

        if (setup.OpensAt is null || setup.ClosesAt is null)
        {
            return Results.Ok(new
            {
                slots = Array.Empty<AvailableSlot>(),
                closed = true,
                hasStaff = false,
                timezone = setup.Timezone,
                opensAt = (string?)null,
                closesAt = (string?)null
            });
        }

        var timezone = ResolveTimeZone(setup.Timezone);
        var dayStart = ToUtc(date, TimeOnly.MinValue, timezone);
        var dayEnd = dayStart.AddDays(1);

        var serviceStaff = (await connection.QueryAsync<StaffItem>(
            new CommandDefinition(
                """
                select st.id as "Id", st.display_name as "DisplayName"
                from public.staff st
                join public.staff_services ss on ss.staff_id = st.id
                where st.salon_id = @SalonId and st.active and ss.service_id = @ServiceId
                order by st.display_name
                """,
                new { setup.SalonId, ServiceId = serviceId },
                cancellationToken: cancellationToken))).AsList();

        var salonStaff = (await connection.QueryAsync<StaffItem>(
            new CommandDefinition(
                """
                select st.id as "Id", st.display_name as "DisplayName"
                from public.staff st
                where st.salon_id = @SalonId and st.active
                order by st.display_name
                """,
                new { setup.SalonId },
                cancellationToken: cancellationToken))).AsList();

        var pool = serviceStaff.Count > 0 ? serviceStaff : salonStaff;

        if (staffId is not null)
        {
            pool = pool.Where(staff => staff.Id == staffId.Value).ToList();
        }

        var busy = (await connection.QueryAsync<BusyPeriod>(
            new CommandDefinition(
                """
                select staff_id as "StaffId", starts_at as "StartsAt", ends_at as "EndsAt"
                from public.appointments
                where salon_id = @SalonId
                  and status in ('pending', 'confirmed')
                  and starts_at < @DayEnd and ends_at > @DayStart
                union all
                select sto.staff_id as "StaffId", sto.starts_at as "StartsAt", sto.ends_at as "EndsAt"
                from public.staff_time_off sto
                join public.staff st on st.id = sto.staff_id
                where st.salon_id = @SalonId
                  and sto.starts_at < @DayEnd and sto.ends_at > @DayStart
                """,
                new { setup.SalonId, DayStart = dayStart, DayEnd = dayEnd },
                cancellationToken: cancellationToken))).AsList();

        var opening = ToUtc(date, setup.OpensAt.Value, timezone);
        var closing = ToUtc(date, setup.ClosesAt.Value, timezone);
        var duration = TimeSpan.FromMinutes(setup.DurationMinutes);
        var slots = new List<AvailableSlot>();
        var seenStarts = new HashSet<DateTime>();

        for (var start = opening; start + duration <= closing; start = start.AddMinutes(15))
        {
            if (start <= DateTime.UtcNow)
            {
                continue;
            }

            var end = start + duration;

            if (staffId is not null)
            {
                var professional = pool.FirstOrDefault();
                if (professional is null || IsStaffBusy(busy, professional.Id, start, end))
                {
                    continue;
                }

                slots.Add(new AvailableSlot(professional.Id, professional.DisplayName, start, end));
                continue;
            }

            // Cualquier profesional: slot solo si al menos uno del pool está libre (se asigna al reservar)
            if (pool.Count == 0)
            {
                continue;
            }

            var hasFreeProfessional = pool.Any(staff => !IsStaffBusy(busy, staff.Id, start, end));
            if (!hasFreeProfessional)
            {
                continue;
            }

            if (seenStarts.Add(start))
            {
                slots.Add(new AvailableSlot(Guid.Empty, "Cualquier profesional", start, end));
            }
        }

        return Results.Ok(new
        {
            slots = slots.OrderBy(slot => slot.StartsAt).ThenBy(slot => slot.StaffName),
            closed = false,
            hasStaff = salonStaff.Count > 0,
            timezone = setup.Timezone,
            opensAt = setup.OpensAt.Value.ToString("HH:mm"),
            closesAt = setup.ClosesAt.Value.ToString("HH:mm")
        });
    }

    private static bool IsStaffBusy(IEnumerable<BusyPeriod> busy, Guid staffId, DateTime start, DateTime end) =>
        busy.Any(period =>
            period.StaffId == staffId
            && period.StartsAt < end
            && period.EndsAt > start);

    private static async Task<Guid?> ResolveStaffForAppointmentAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid salonId,
        Guid serviceId,
        Guid preferredStaffId,
        DateTime startsAt,
        DateTime endsAt,
        CancellationToken cancellationToken)
    {
        var serviceStaff = (await connection.QueryAsync<StaffItem>(
            new CommandDefinition(
                """
                select st.id as "Id", st.display_name as "DisplayName"
                from public.staff st
                join public.staff_services ss on ss.staff_id = st.id
                where st.salon_id = @SalonId and st.active and ss.service_id = @ServiceId
                order by st.display_name
                """,
                new { SalonId = salonId, ServiceId = serviceId },
                transaction,
                cancellationToken: cancellationToken))).AsList();

        var salonStaff = (await connection.QueryAsync<StaffItem>(
            new CommandDefinition(
                """
                select st.id as "Id", st.display_name as "DisplayName"
                from public.staff st
                where st.salon_id = @SalonId and st.active
                order by st.display_name
                """,
                new { SalonId = salonId },
                transaction,
                cancellationToken: cancellationToken))).AsList();

        var pool = serviceStaff.Count > 0 ? serviceStaff : salonStaff;
        if (pool.Count == 0)
        {
            await EnsureSalonStaffAsync(connection, transaction, salonId, serviceId, cancellationToken);

            serviceStaff = (await connection.QueryAsync<StaffItem>(
                new CommandDefinition(
                    """
                    select st.id as "Id", st.display_name as "DisplayName"
                    from public.staff st
                    join public.staff_services ss on ss.staff_id = st.id
                    where st.salon_id = @SalonId and st.active and ss.service_id = @ServiceId
                    order by st.display_name
                    """,
                    new { SalonId = salonId, ServiceId = serviceId },
                    transaction,
                    cancellationToken: cancellationToken))).AsList();

            salonStaff = (await connection.QueryAsync<StaffItem>(
                new CommandDefinition(
                    """
                    select st.id as "Id", st.display_name as "DisplayName"
                    from public.staff st
                    where st.salon_id = @SalonId and st.active
                    order by st.display_name
                    """,
                    new { SalonId = salonId },
                    transaction,
                    cancellationToken: cancellationToken))).AsList();

            pool = serviceStaff.Count > 0 ? serviceStaff : salonStaff;
        }

        if (pool.Count == 0)
        {
            return null;
        }

        var busy = (await connection.QueryAsync<BusyPeriod>(
            new CommandDefinition(
                """
                select staff_id as "StaffId", starts_at as "StartsAt", ends_at as "EndsAt"
                from public.appointments
                where salon_id = @SalonId
                  and status in ('pending', 'confirmed')
                  and starts_at < @EndsAt and ends_at > @StartsAt
                union all
                select sto.staff_id as "StaffId", sto.starts_at as "StartsAt", sto.ends_at as "EndsAt"
                from public.staff_time_off sto
                join public.staff st on st.id = sto.staff_id
                where st.salon_id = @SalonId
                  and sto.starts_at < @EndsAt and sto.ends_at > @StartsAt
                """,
                new { SalonId = salonId, StartsAt = startsAt, EndsAt = endsAt },
                transaction,
                cancellationToken: cancellationToken))).AsList();

        if (preferredStaffId != Guid.Empty)
        {
            var preferred = pool.FirstOrDefault(staff => staff.Id == preferredStaffId);
            if (preferred is not null && !IsStaffBusy(busy, preferred.Id, startsAt, endsAt))
            {
                return preferred.Id;
            }

            return null;
        }

        var freeProfessional = pool.FirstOrDefault(staff => !IsStaffBusy(busy, staff.Id, startsAt, endsAt));
        return freeProfessional?.Id;
    }

    private static async Task EnsureSalonStaffAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid salonId,
        Guid serviceId,
        CancellationToken cancellationToken)
    {
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                insert into public.staff (salon_id, user_id, display_name)
                select sm.salon_id, sm.user_id,
                       coalesce(p.display_name, split_part(p.email, '@', 1), 'Profesional')
                from public.salon_members sm
                left join public.profiles p on p.id = sm.user_id
                where sm.salon_id = @SalonId
                  and sm.role = 'owner'
                  and not exists (
                    select 1 from public.staff st
                    where st.salon_id = sm.salon_id and st.user_id = sm.user_id
                  )
                on conflict (salon_id, user_id) do nothing;

                insert into public.staff (salon_id, user_id, display_name)
                select sm.salon_id, sm.user_id, coalesce(p.display_name, 'Profesional')
                from public.salon_members sm
                left join public.profiles p on p.id = sm.user_id
                where sm.salon_id = @SalonId
                  and not exists (
                    select 1 from public.staff where salon_id = @SalonId and active
                  )
                order by case sm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
                         sm.created_at
                limit 1
                on conflict (salon_id, user_id) do nothing;

                insert into public.staff (salon_id, user_id, display_name)
                select s.id, null, s.name || ' — Atención'
                from public.salons s
                where s.id = @SalonId
                  and not exists (
                    select 1 from public.staff where salon_id = @SalonId and active
                  );

                insert into public.staff_services (staff_id, service_id)
                select st.id, sv.id
                from public.staff st
                cross join public.services sv
                where st.salon_id = @SalonId
                  and st.active
                  and sv.salon_id = @SalonId
                  and sv.active
                on conflict do nothing;
                """,
                new { SalonId = salonId },
                transaction,
                cancellationToken: cancellationToken));
    }

    private static async Task<IResult> CreateAppointment(
        string slug,
        CreateAppointmentRequest request,
        IDbConnectionFactory db,
        MercadoPagoService mercadoPago,
        WhatsAppService whatsApp,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.CustomerName)
            || string.IsNullOrWhiteSpace(request.CustomerPhone)
            || string.IsNullOrWhiteSpace(request.CustomerEmail))
        {
            return Results.BadRequest(new { message = "Nombre, teléfono y email son obligatorios." });
        }

        var customerEmail = request.CustomerEmail.Trim();
        if (!customerEmail.Contains('@'))
        {
            return Results.BadRequest(new { message = "Ingresá un email válido." });
        }

        var paymentMethod = (request.PaymentMethod ?? "salon").Trim().ToLowerInvariant();
        if (paymentMethod is not ("salon" or "mercadopago"))
        {
            return Results.BadRequest(new { message = "Elegí un método de pago válido." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            await ExpireStalePaymentsAsync(connection, transaction, cancellationToken);

            var salonService = await connection.QuerySingleOrDefaultAsync<BookingSetup>(
                new CommandDefinition(
                    """
                    select s.id as "SalonId", s.name as "SalonName", s.timezone as "Timezone",
                           sv.name as "ServiceName", sv.duration_minutes as "DurationMinutes",
                           sv.price as "Price"
                    from public.salons s
                    join public.services sv on sv.salon_id = s.id and sv.id = @ServiceId and sv.active
                    where s.slug = @Slug and s.active
                    """,
                    new { Slug = slug, request.ServiceId },
                    transaction,
                    cancellationToken: cancellationToken));

            if (salonService is null)
            {
                return Results.BadRequest(new { message = "Servicio o peluquería no válidos." });
            }

            if (paymentMethod == "mercadopago" && salonService.Price <= 0)
            {
                paymentMethod = "salon";
            }

            if (paymentMethod == "mercadopago" && !mercadoPago.IsConfigured)
            {
                return Results.Json(
                    new { message = "Mercado Pago no está configurado. Elegí pagar en el salón." },
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            var startsAt = request.StartsAt.UtcDateTime;
            var endsAt = startsAt.AddMinutes(salonService.DurationMinutes);
            if (startsAt <= DateTime.UtcNow)
            {
                return Results.BadRequest(new { message = "El turno debe ser futuro." });
            }

            var staffId = await ResolveStaffForAppointmentAsync(
                connection,
                transaction,
                salonService.SalonId,
                request.ServiceId,
                request.StaffId,
                startsAt,
                endsAt,
                cancellationToken);

            if (staffId is null)
            {
                return Results.BadRequest(new
                {
                    message = "Este salón aún no tiene profesionales configurados. Contactá al negocio."
                });
            }

            var isOpen = await connection.ExecuteScalarAsync<bool>(
                new CommandDefinition(
                    """
                    select exists (
                      select 1
                      from public.business_hours bh
                      where bh.salon_id = @SalonId
                        and bh.weekday = extract(dow from (@StartsAt at time zone @Timezone))::int
                        and (@StartsAt at time zone @Timezone)::time >= bh.opens_at
                        and (@EndsAt at time zone @Timezone)::time <= bh.closes_at
                    )
                    """,
                    new { salonService.SalonId, StartsAt = startsAt, EndsAt = endsAt, salonService.Timezone },
                    transaction,
                    cancellationToken: cancellationToken));

            if (!isOpen)
            {
                return Results.BadRequest(new { message = "El horario elegido está fuera del horario de atención." });
            }

            var customerId = await connection.ExecuteScalarAsync<Guid>(
                new CommandDefinition(
                    """
                    insert into public.customers (salon_id, name, phone, email)
                    values (@SalonId, @Name, @Phone, @Email)
                    on conflict (salon_id, phone) do update
                    set name = excluded.name,
                        email = coalesce(excluded.email, public.customers.email)
                    returning id
                    """,
                    new
                    {
                        salonService.SalonId,
                        Name = request.CustomerName.Trim(),
                        Phone = request.CustomerPhone.Trim(),
                        Email = customerEmail
                    },
                    transaction,
                    cancellationToken: cancellationToken));

            var payOnline = paymentMethod == "mercadopago";
            var appointmentStatus = "confirmed";
            var paymentStatus = payOnline ? "pending" : "unpaid";
            var paymentExpiresAt = payOnline ? DateTimeOffset.UtcNow.AddMinutes(20) : (DateTimeOffset?)null;

            var appointmentId = await connection.ExecuteScalarAsync<Guid>(
                new CommandDefinition(
                    """
                    insert into public.appointments
                      (salon_id, staff_id, service_id, customer_id, starts_at, ends_at, notes,
                       status, payment_method, payment_status, payment_amount, payment_expires_at)
                    values
                      (@SalonId, @StaffId, @ServiceId, @CustomerId, @StartsAt, @EndsAt, @Notes,
                       @Status, @PaymentMethod, @PaymentStatus, @PaymentAmount, @PaymentExpiresAt)
                    returning id
                    """,
                    new
                    {
                        salonService.SalonId,
                        StaffId = staffId.Value,
                        request.ServiceId,
                        CustomerId = customerId,
                        StartsAt = startsAt,
                        EndsAt = endsAt,
                        Notes = NullIfEmpty(request.Notes),
                        Status = appointmentStatus,
                        PaymentMethod = paymentMethod,
                        PaymentStatus = paymentStatus,
                        PaymentAmount = salonService.Price,
                        PaymentExpiresAt = paymentExpiresAt,
                    },
                    transaction,
                    cancellationToken: cancellationToken));

            string? checkoutUrl = null;
            if (payOnline)
            {
                var appUrl = mercadoPago.PublicAppUrl;
                var notificationUrl = string.IsNullOrWhiteSpace(mercadoPago.PublicApiUrl)
                    ? null
                    : $"{mercadoPago.PublicApiUrl}/api/public/payments/mercadopago/webhook";
                var returnUrl = $"{appUrl}/s/{slug}?turno={appointmentId}";

                var preference = await mercadoPago.CreatePreferenceAsync(
                    new MercadoPagoPreferenceRequest(
                        appointmentId.ToString(),
                        slug,
                        $"{salonService.ServiceName} · {salonService.SalonName}",
                        $"Turno el {startsAt:dd/MM HH:mm} UTC",
                        salonService.Price,
                        request.CustomerName.Trim(),
                        customerEmail,
                        $"{returnUrl}&pago=ok",
                        $"{returnUrl}&pago=error",
                        $"{returnUrl}&pago=pendiente",
                        paymentExpiresAt!.Value,
                        notificationUrl,
                        Metadata: new
                        {
                            appointment_id = appointmentId.ToString(),
                            salon_slug = slug,
                        }),
                    cancellationToken);

                await connection.ExecuteAsync(
                    new CommandDefinition(
                        """
                        update public.appointments
                        set mp_preference_id = @PreferenceId
                        where id = @AppointmentId
                        """,
                        new { PreferenceId = preference.Id, AppointmentId = appointmentId },
                        transaction,
                        cancellationToken: cancellationToken));

                checkoutUrl = preference.CheckoutUrl;
            }

            await transaction.CommitAsync(cancellationToken);

            if (paymentStatus != "pending")
            {
                await TrySendWhatsAppConfirmationAsync(
                    connection,
                    whatsApp,
                    appointmentId,
                    cancellationToken);
            }

            return Results.Created(
                $"/api/public/salons/{slug}/appointments/{appointmentId}",
                new
                {
                    id = appointmentId,
                    startsAt,
                    endsAt,
                    status = appointmentStatus,
                    paymentMethod,
                    paymentStatus,
                    checkoutUrl,
                });
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.ExclusionViolation)
        {
            await transaction.RollbackAsync(cancellationToken);
            return Results.Conflict(new { message = "Ese horario acaba de ser reservado. Elegí otro." });
        }
        catch (InvalidOperationException exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            return Results.Json(new { message = exception.Message }, statusCode: StatusCodes.Status502BadGateway);
        }
    }

    private static IResult MercadoPagoWebhookPing() => Results.Ok(new { ok = true });

    private static async Task<IResult> HandleMercadoPagoWebhook(
        HttpRequest httpRequest,
        MercadoPagoService mercadoPago,
        WhatsAppService whatsApp,
        IDbConnectionFactory db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        if (!mercadoPago.IsConfigured)
        {
            return Results.Ok(new { ok = true });
        }

        MercadoPagoWebhookPayload? payload = null;
        try
        {
            payload = await httpRequest.ReadFromJsonAsync<MercadoPagoWebhookPayload>(cancellationToken);
        }
        catch (Exception)
        {
            // Mercado Pago a veces manda query string en vez de JSON.
        }

        var paymentId = FirstNonEmpty(
            payload?.Data?.Id,
            httpRequest.Query["data.id"].ToString(),
            httpRequest.Query["id"].ToString());
        var type = FirstNonEmpty(payload?.Type, httpRequest.Query["type"].ToString(), httpRequest.Query["topic"].ToString());

        if (string.IsNullOrWhiteSpace(paymentId)
            || (!string.IsNullOrWhiteSpace(type) && !type.Contains("payment", StringComparison.OrdinalIgnoreCase)))
        {
            return Results.Ok(new { ok = true });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        await ApplyMercadoPagoPaymentAsync(
            connection,
            mercadoPago,
            whatsApp,
            paymentId,
            appointmentId: null,
            productOrderId: null,
            loggerFactory.CreateLogger("MercadoPagoWebhook"),
            cancellationToken);
        return Results.Ok(new { ok = true });
    }

    private static async Task<IResult> SyncAppointmentPayment(
        string slug,
        Guid id,
        string? paymentId,
        IDbConnectionFactory db,
        MercadoPagoService mercadoPago,
        WhatsAppService whatsApp,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        await ExpireStalePaymentsAsync(connection, null, cancellationToken);

        if (mercadoPago.IsConfigured)
        {
            await ApplyMercadoPagoPaymentAsync(
                connection,
                mercadoPago,
                whatsApp,
                paymentId,
                appointmentId: id,
                productOrderId: null,
                loggerFactory.CreateLogger("MercadoPagoPayments"),
                cancellationToken);
        }

        var appointment = await connection.QuerySingleOrDefaultAsync<PublicAppointmentPayment>(
            new CommandDefinition(
                """
                select a.id as "Id", a.starts_at as "StartsAt", a.ends_at as "EndsAt",
                       a.status as "Status", a.payment_method as "PaymentMethod",
                       a.payment_status as "PaymentStatus", sv.name as "ServiceName",
                       st.display_name as "StaffName", st.id as "StaffId",
                       sv.id as "ServiceId", sv.module_key as "ModuleKey"
                from public.appointments a
                join public.salons s on s.id = a.salon_id
                join public.services sv on sv.id = a.service_id
                join public.staff st on st.id = a.staff_id
                where a.id = @Id and s.slug = @Slug and s.active
                  and a.created_at >= now() - interval '6 hours'
                """,
                new { Id = id, Slug = slug },
                cancellationToken: cancellationToken));

        if (appointment is null)
        {
            return Results.NotFound(new { message = "No encontramos ese turno." });
        }

        return Results.Ok(appointment);
    }

    private static async Task<IResult> SimulateTestPayment(
        string slug,
        Guid id,
        MercadoPagoService mercadoPago,
        WhatsAppService whatsApp,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!mercadoPago.IsTestCredentials)
        {
            return Results.Json(
                new { message = "La simulación de pago solo está disponible con credenciales de prueba." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);

        var updated = await connection.ExecuteAsync(
            new CommandDefinition(
                """
                update public.appointments a
                set status = 'confirmed',
                    payment_status = 'paid',
                    payment_channel = 'mercadopago',
                    paid_at = coalesce(a.paid_at, now()),
                    mp_payment_id = coalesce(a.mp_payment_id, 'demo-' || a.id::text)
                from public.salons s
                where a.id = @Id
                  and s.id = a.salon_id
                  and s.slug = @Slug
                  and s.active
                  and a.payment_method = 'mercadopago'
                  and a.payment_status = 'pending'
                  and a.status in ('pending', 'confirmed')
                  and a.created_at >= now() - interval '6 hours'
                """,
                new { Id = id, Slug = slug },
                cancellationToken: cancellationToken));

        if (updated == 0)
        {
            return Results.BadRequest(new { message = "No hay un pago de prueba pendiente para este turno." });
        }

        await TrySendWhatsAppConfirmationAsync(connection, whatsApp, id, cancellationToken);

        var appointment = await connection.QuerySingleOrDefaultAsync<PublicAppointmentPayment>(
            new CommandDefinition(
                """
                select a.id as "Id", a.starts_at as "StartsAt", a.ends_at as "EndsAt",
                       a.status as "Status", a.payment_method as "PaymentMethod",
                       a.payment_status as "PaymentStatus", sv.name as "ServiceName",
                       st.display_name as "StaffName", st.id as "StaffId",
                       sv.id as "ServiceId", sv.module_key as "ModuleKey"
                from public.appointments a
                join public.salons s on s.id = a.salon_id
                join public.services sv on sv.id = a.service_id
                join public.staff st on st.id = a.staff_id
                where a.id = @Id and s.slug = @Slug
                """,
                new { Id = id, Slug = slug },
                cancellationToken: cancellationToken));

        return appointment is null
            ? Results.NotFound(new { message = "No encontramos ese turno." })
            : Results.Ok(appointment);
    }

    private static async Task ApplyMercadoPagoPaymentAsync(
        NpgsqlConnection connection,
        MercadoPagoService mercadoPago,
        WhatsAppService? whatsApp,
        string? paymentId,
        Guid? appointmentId,
        Guid? productOrderId,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        MercadoPagoPayment? payment = null;
        if (!string.IsNullOrWhiteSpace(paymentId))
        {
            payment = await mercadoPago.GetPaymentAsync(paymentId, cancellationToken);
        }

        if (payment is null && appointmentId is not null)
        {
            payment = await mercadoPago.FindPaymentByAppointmentAsync(appointmentId.Value, cancellationToken);
        }

        if (payment is null && productOrderId is not null)
        {
            payment = await mercadoPago.FindPaymentByExternalReferenceAsync(
                $"store:{productOrderId.Value}",
                cancellationToken);
        }

        if (payment is null)
        {
            return;
        }

        var targetAppointmentId = payment.AppointmentId ?? appointmentId;
        var targetProductOrderId = payment.ProductOrderId;
        if (productOrderId is not null && targetProductOrderId != productOrderId)
        {
            return;
        }
        var outcome = MercadoPagoService.MapStatus(payment.Status);

        if (targetProductOrderId is not null)
        {
            try
            {
                var updated = await connection.ExecuteAsync(
                    new CommandDefinition(
                        """
                        update public.product_orders
                        set mp_payment_id = @PaymentId,
                            payment_channel = case when @PaymentStatus = 'paid'
                              then 'mercadopago' else payment_channel end,
                            paid_at = case when @PaymentStatus = 'paid'
                              then coalesce(paid_at, now()) else paid_at end,
                            payment_status = case
                              when @PaymentStatus = 'paid' then 'paid'
                              when @PaymentStatus = 'pending' then 'pending'
                              when @PaymentStatus = 'refunded' then 'refunded'
                              else 'failed'
                            end,
                            status = case
                              when @PaymentStatus = 'paid' then 'confirmed'
                              when @PaymentStatus = 'pending' then 'pending'
                              else 'cancelled'
                            end
                        where id = @OrderId
                          and payment_method = 'mercadopago'
                          and (@PaymentStatus in ('paid', 'refunded') or payment_status not in ('paid', 'refunded'))
                          and not (@PaymentStatus = 'paid' and payment_status = 'refunded')
                          and (@PaymentStatus = 'paid' or status in ('pending', 'confirmed', 'awaiting_stock'))
                          and @Amount = (
                            select sum(i.quantity * i.unit_price)
                            from public.product_order_items i where i.order_id = @OrderId
                          )
                          and @Currency = 'ARS'
                        """,
                        new
                        {
                            OrderId = targetProductOrderId.Value,
                            PaymentId = payment.Id,
                            outcome.PaymentStatus,
                            payment.Amount,
                            payment.Currency,
                        },
                        cancellationToken: cancellationToken));
                if (updated == 0)
                    logger.LogWarning("Pago {PaymentId} no aplicado al pedido {OrderId}: importe, moneda o estado incompatible",
                        payment.Id, targetProductOrderId);
            }
            catch (PostgresException exception) when (exception.SqlState == "P0001" && outcome.PaymentStatus == "paid")
            {
                logger.LogWarning(exception, "Pago aprobado sin stock suficiente para {OrderId}", targetProductOrderId);
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    update public.product_orders
                    set payment_status = 'paid', status = 'awaiting_stock', mp_payment_id = @PaymentId
                        , payment_channel = 'mercadopago', paid_at = coalesce(paid_at, now())
                    where id = @OrderId and payment_method = 'mercadopago'
                      and payment_status <> 'refunded' and status <> 'confirmed'
                    """, new { OrderId = targetProductOrderId.Value, PaymentId = payment.Id },
                    cancellationToken: cancellationToken));
            }

            return;
        }

        if (targetAppointmentId is null)
        {
            return;
        }

        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                update public.appointments
                set mp_payment_id = @PaymentId,
                    payment_channel = case when @PaymentStatus = 'paid'
                      then 'mercadopago' else payment_channel end,
                    paid_at = case when @PaymentStatus = 'paid'
                      then coalesce(paid_at, now()) else paid_at end,
                    payment_status = case
                      when @PaymentStatus = 'paid' then 'paid'
                      when @PaymentStatus = 'pending' then 'pending'
                      else 'unpaid'
                    end,
                    status = 'confirmed'
                where id = @AppointmentId
                  and payment_method = 'mercadopago'
                  and status in ('pending', 'confirmed')
                """,
                new
                {
                    AppointmentId = targetAppointmentId.Value,
                    PaymentId = payment.Id,
                    outcome.PaymentStatus,
                    outcome.AppointmentStatus,
                },
                cancellationToken: cancellationToken));

        if (outcome.PaymentStatus == "paid" && whatsApp is not null)
        {
            await TrySendWhatsAppConfirmationAsync(connection, whatsApp, targetAppointmentId.Value, cancellationToken);
        }
    }

    private static async Task TrySendWhatsAppConfirmationAsync(
        NpgsqlConnection connection,
        WhatsAppService whatsApp,
        Guid appointmentId,
        CancellationToken cancellationToken)
    {
        if (!whatsApp.IsConfigured)
        {
            return;
        }

        WhatsAppAppointmentRow? row;
        try
        {
            row = await connection.QuerySingleOrDefaultAsync<WhatsAppAppointmentRow>(
                new CommandDefinition(
                    """
                    select a.id as "Id", c.name as "CustomerName", c.phone as "CustomerPhone",
                           s.name as "SalonName", sv.name as "ServiceName", a.starts_at as "StartsAt",
                           s.timezone as "Timezone", a.payment_status as "PaymentStatus"
                    from public.appointments a
                    join public.customers c on c.id = a.customer_id
                    join public.salons s on s.id = a.salon_id
                    join public.services sv on sv.id = a.service_id
                    where a.id = @AppointmentId
                      and a.status = 'confirmed'
                      and a.whatsapp_confirmation_sent_at is null
                    """,
                    new { AppointmentId = appointmentId },
                    cancellationToken: cancellationToken));
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UndefinedColumn)
        {
            return;
        }

        if (row is null || row.PaymentStatus == "pending")
        {
            return;
        }

        var sent = await whatsApp.TrySendAppointmentConfirmationAsync(
            appointmentId,
            row.CustomerPhone,
            row.CustomerName,
            row.SalonName,
            row.ServiceName,
            row.StartsAt,
            row.Timezone,
            cancellationToken);

        if (!sent)
        {
            return;
        }

        try
        {
            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    update public.appointments
                    set whatsapp_confirmation_sent_at = now()
                    where id = @AppointmentId
                      and whatsapp_confirmation_sent_at is null
                    """,
                    new { AppointmentId = appointmentId },
                    cancellationToken: cancellationToken));
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UndefinedColumn)
        {
            // Migración 016 pendiente.
        }
    }

    private static async Task ExpireStalePaymentsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        CancellationToken cancellationToken)
    {
        try
        {
            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    update public.appointments
                    set status = 'confirmed',
                        payment_status = case
                          when payment_status = 'paid' then payment_status
                          else 'unpaid'
                        end
                    where payment_method = 'mercadopago'
                      and status in ('pending', 'confirmed')
                      and (
                        status = 'pending'
                        or (
                          payment_status = 'pending'
                          and payment_expires_at is not null
                          and payment_expires_at < now()
                        )
                      )
                    """,
                    transaction: transaction,
                    cancellationToken: cancellationToken));
        }
        catch (PostgresException exception) when (exception.SqlState == "42703")
        {
            // Todavía no se aplicó supabase/014_appointment_payments.sql
        }

        try
        {
            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    update public.product_orders
                    set status = 'cancelled',
                        payment_status = case
                          when payment_status = 'paid' then payment_status
                          else 'failed'
                        end
                    where payment_method = 'mercadopago'
                      and status = 'pending'
                      and payment_status = 'pending'
                      and payment_expires_at is not null
                      and payment_expires_at < now()
                    """,
                    transaction: transaction,
                    cancellationToken: cancellationToken));
        }
        catch (PostgresException exception) when (exception.SqlState is PostgresErrorCodes.UndefinedTable)
        {
            // Migración 020 pendiente.
        }
    }

    private static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

    private static async Task<IResult> UpdateSalonStore(
        UpdateSalonStoreRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (request.StoreEnabled is null)
        {
            return Results.BadRequest(new { message = "Indicá si la tienda está visible para clientes." });
        }

        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        if (!await SalonHasProductsModule(salonId.Value, db, cancellationToken))
        {
            return Results.Json(
                new { message = "El módulo de productos no está habilitado." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var updated = await connection.ExecuteAsync(
            new CommandDefinition(
                """
                update public.salons
                set store_enabled = @StoreEnabled
                where id = @SalonId and active
                """,
                new { SalonId = salonId, StoreEnabled = request.StoreEnabled.Value },
                cancellationToken: cancellationToken));

        return updated == 0
            ? Results.NotFound(new { message = "No se encontró una peluquería para este usuario." })
            : Results.Ok(new { storeEnabled = request.StoreEnabled.Value });
    }

    private static async Task<IResult> UpdateSalonLogo(
        UpdateSalonLogoRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null)
        {
            return Results.NotFound(new { message = "No se encontró una peluquería para este usuario." });
        }

        if (request.LogoUrl is null)
        {
            return Results.BadRequest(new { message = "Indicá el logo a guardar." });
        }

        var logoUrl = string.IsNullOrWhiteSpace(request.LogoUrl) ? null : request.LogoUrl.Trim();
        if (logoUrl is not null && !IsOwnSalonLogoUrl(logoUrl, salonId.Value))
        {
            return Results.BadRequest(new { message = "El logo tiene que ser una imagen para el salon." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var updated = await connection.ExecuteAsync(
            new CommandDefinition(
                """
                update public.salons
                set logo_url = @LogoUrl
                where id = @SalonId and active
                """,
                new { SalonId = salonId, LogoUrl = logoUrl },
                cancellationToken: cancellationToken));

        return updated == 0
            ? Results.NotFound(new { message = "No se encontró una peluquería para este usuario." })
            : Results.Ok(new { id = salonId, logoUrl });
    }

    private static bool IsOwnSalonLogoUrl(string logoUrl, Guid salonId)
    {
        if (!Uri.TryCreate(logoUrl, UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (uri.Scheme is not ("https" or "http"))
        {
            return false;
        }

        var marker = $"/storage/v1/object/public/salon-logos/{salonId}/";
        return uri.AbsolutePath.Contains(marker, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsOwnSalonProductImageUrl(string imageUrl, Guid salonId)
    {
        if (!Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (uri.Scheme is not ("https" or "http"))
        {
            return false;
        }

        var marker = $"/storage/v1/object/public/salon-products/{salonId}/";
        return uri.AbsolutePath.Contains(marker, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<bool> SalonHasProductsModule(
        Guid salonId,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        await using var connection = (NpgsqlConnection)db.Create();
        return await connection.ExecuteScalarAsync<bool>(
            new CommandDefinition(
                """
                select exists (
                  select 1
                  from public.salon_modules sm
                  join public.platform_modules pm on pm.key = sm.module_key
                  where sm.salon_id = @SalonId
                    and sm.module_key = 'products' and sm.enabled and pm.active
                )
                """,
                new { SalonId = salonId },
                cancellationToken: cancellationToken));
    }

    private static async Task<Guid?> GetSalonId(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId))
        {
            return null;
        }

        await using var connection = (NpgsqlConnection)db.Create();
        return await connection.ExecuteScalarAsync<Guid?>(
            new CommandDefinition(
                """
                select s.id
                from public.salon_members sm
                join public.salons s on s.id = sm.salon_id
                where sm.user_id = @UserId and s.active
                order by sm.created_at
                limit 1
                """,
                new { UserId = userId },
                cancellationToken: cancellationToken));
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);

    private static TimeZoneInfo ResolveTimeZone(string id)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(id);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    private static DateTime ToUtc(DateOnly date, TimeOnly time, TimeZoneInfo timezone)
    {
        var local = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        return new DateTimeOffset(local, timezone.GetUtcOffset(local)).UtcDateTime;
    }

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private sealed record SalonModuleItem(string Key, string Name);
    private sealed record SalonSummary(Guid Id, string Name, string Slug, string Timezone, string Role);
    private static async Task<List<DashboardRankPoint>> ReadTopProductsAsync(
        NpgsqlConnection connection,
        Guid salonId,
        CancellationToken cancellationToken)
    {
        try
        {
            return (await connection.QueryAsync<DashboardRankPoint>(
                new CommandDefinition(
                    """
                    select i.product_name as "Name", sum(i.quantity)::int as "Count"
                    from public.product_orders o
                    join public.product_order_items i on i.order_id = o.id
                    where o.salon_id = @SalonId
                      and o.payment_status = 'paid'
                      and o.created_at >= now() - interval '30 days'
                    group by i.product_id, i.product_name
                    order by sum(i.quantity) desc, i.product_name
                    limit 6
                    """,
                    new { SalonId = salonId },
                    cancellationToken: cancellationToken))).AsList();
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UndefinedTable)
        {
            return [];
        }
    }

    private static List<DashboardHourPoint> FillBusyHours(List<DashboardHourPoint> hours)
    {
        if (hours.Count == 0)
        {
            return hours;
        }

        var min = hours.Min(hour => hour.Hour);
        var max = hours.Max(hour => hour.Hour);
        var counts = hours.ToDictionary(hour => hour.Hour, hour => hour.Count);
        return Enumerable.Range(min, max - min + 1)
            .Select(hour => new DashboardHourPoint(hour, counts.GetValueOrDefault(hour)))
            .ToList();
    }

    private sealed record DashboardStats(int Today, int Upcoming, int Customers, int Visits);
    private sealed record DashboardCustomerPoint(string Name, int Visits, DateTime LastVisitAt);
    private sealed record DashboardDayPoint(string Day, int Count);
    private sealed record DashboardRankPoint(string Name, int Count);
    private sealed record DashboardHourPoint(int Hour, int Count);
    private sealed record AppointmentListItem(
        Guid Id,
        DateTime StartsAt,
        DateTime EndsAt,
        string Status,
        string CustomerName,
        string CustomerPhone,
        string ServiceName,
        string StaffName,
        string? Detalle = null,
        string? Notes = null,
        string? PaymentMethod = null,
        string? PaymentStatus = null);
    private sealed record ServiceItem(
        Guid Id,
        string Name,
        string? Description,
        int DurationMinutes,
        decimal Price,
        bool Active,
        string ModuleKey);
    private sealed record PublicModuleItem(string Key, string Name);
    private sealed record PublicServiceItem(
        Guid Id,
        string Name,
        string? Description,
        int DurationMinutes,
        decimal Price,
        string ModuleKey,
        string? CatalogKey);
    private sealed record CustomerItem(
        Guid Id,
        string Name,
        string Phone,
        string? Email,
        int AppointmentCount,
        DateTime? LastAppointmentAt);
    private sealed record StaffListItem(
        Guid Id,
        string DisplayName,
        bool Active,
        string? Email,
        string ServiceNames);
    private sealed record PublicSalon(
        Guid Id,
        string Name,
        string Slug,
        string Timezone,
        string? Phone,
        string? Address,
        string? LogoUrl,
        bool StoreEnabled);
    private sealed record BoolValue(bool Value);
    private sealed record PublicStoreSalon(string Name, string? LogoUrl, bool StoreEnabled);
    private sealed record PublicProductItem(
        Guid Id,
        string Name,
        string? Description,
        decimal Price,
        string? ImageUrl,
        string? Category,
        string? Brand,
        int? SizeMl,
        bool InStock);
    private sealed record ProductItem(
        Guid Id,
        string Name,
        string? Description,
        decimal Price,
        string? ImageUrl,
        bool Active,
        int SortOrder,
        string? Category,
        int? Stock,
        string? Brand,
        int? SizeMl);
    private sealed record PublicProductOrder(
        Guid Id,
        string ProductName,
        string PaymentStatus,
        string Status,
        decimal Amount);
    private sealed record StaffServiceRow(Guid Id, string DisplayName, Guid ServiceId);
    private sealed record PublicStaff(Guid Id, string DisplayName, Guid[] ServiceIds);
    private sealed record StaffItem(Guid Id, string DisplayName);
    private sealed record AvailabilitySetup(
        Guid SalonId,
        string Timezone,
        int DurationMinutes,
        TimeOnly? OpensAt,
        TimeOnly? ClosesAt);
    private sealed record BookingSetup(
        Guid SalonId,
        string SalonName,
        string Timezone,
        string ServiceName,
        int DurationMinutes,
        decimal Price);
    private sealed record WhatsAppAppointmentRow(
        Guid Id,
        string CustomerName,
        string CustomerPhone,
        string SalonName,
        string ServiceName,
        DateTime StartsAt,
        string Timezone,
        string PaymentStatus);
    private sealed record PublicAppointmentPayment(
        Guid Id,
        DateTime StartsAt,
        DateTime EndsAt,
        string Status,
        string PaymentMethod,
        string PaymentStatus,
        string ServiceName,
        string StaffName,
        Guid StaffId,
        Guid ServiceId,
        string ModuleKey);
    private sealed record MercadoPagoWebhookPayload(string? Type, MercadoPagoWebhookData? Data);
    private sealed record MercadoPagoWebhookData(string? Id);
    private sealed record HairPreviewBooking(Guid AppointmentId, int HairPreviewCount, string ModuleKey);
    private sealed record BusyPeriod(
        Guid StaffId,
        DateTime StartsAt,
        DateTime EndsAt);
    private sealed record AvailableSlot(
        Guid StaffId,
        string StaffName,
        DateTime StartsAt,
        DateTime EndsAt);
}

public sealed record CreateAppointmentRequest(
    Guid ServiceId,
    Guid StaffId,
    DateTimeOffset StartsAt,
    string CustomerName,
    string CustomerPhone,
    string? CustomerEmail,
    string? Notes,
    string? PaymentMethod);

public sealed record UpdateServiceRequest(bool? Active, decimal? Price);

public sealed record UpdateSalonLogoRequest(string? LogoUrl);

public sealed record UpdateSalonStoreRequest(bool? StoreEnabled);

public sealed record CreateStaffRequest(string? DisplayName, Guid[]? ServiceIds);

public sealed record UpdateStaffRequest(bool? Active);

public sealed record CreateProductRequest(
    string? Name,
    string? Description,
    decimal Price,
    string? ImageUrl,
    bool? Active,
    string? Category,
    int? Stock,
    string? Brand = null,
    int? SizeMl = null);

public sealed record UpdateProductRequest(
    string? Name,
    string? Description,
    decimal? Price,
    string? ImageUrl,
    bool? Active,
    string? Category,
    int? Stock,
    bool? ClearStock,
    string? Brand = null,
    int? SizeMl = null,
    bool? ClearSizeMl = null);
