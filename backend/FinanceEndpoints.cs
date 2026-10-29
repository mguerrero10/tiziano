using System.Security.Claims;
using Dapper;
using Npgsql;
using StudentHub.Api.Data;

namespace StudentHub.Api;

// to do termnar modulo caja, slamente mostramos listado de pagos y ventas
// revisar los dappers
public static partial class SalonEndpoints
{
    private static async Task<IResult> GetFinanceTransactions(
        DateOnly? from,
        DateOnly? to,
        string? source,
        string? status,
        string? channel,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        IFinanceService finance,
        CancellationToken cancellationToken)
    {
        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null) return TypedResults.NotFound();

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        var enabled = await connection.ExecuteScalarAsync<bool>(new CommandDefinition(
            """
            select exists (
              select 1
              from public.salon_modules sm
              join public.platform_modules pm on pm.key = sm.module_key
              where sm.salon_id = @SalonId and sm.enabled and pm.active
                and sm.module_key in ('hair', 'spa', 'nails', 'lashes', 'products')
            )
            """, new { SalonId = salonId }, cancellationToken: cancellationToken));
        if (!enabled) return TypedResults.Forbid();

        var end = to ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var start = from ?? end.AddDays(-30);
        if (start > end || end.DayNumber - start.DayNumber > 366)
            return TypedResults.BadRequest(new { message = "El rango de fechas debe ser válido y no superar un año." });
        if (source is not (null or "all" or "appointment" or "product"))
            return TypedResults.BadRequest(new { message = "El origen seleccionado no es válido." });
        if (status is not (null or "all" or "paid" or "unpaid" or "pending" or "failed" or "refunded"))
            return TypedResults.BadRequest(new { message = "El estado de pago seleccionado no es válido." });
        if (channel is not (null or "all" or "salon" or "cash" or "transfer" or "debit" or "credit" or "mercadopago" or "unknown"))
            return TypedResults.BadRequest(new { message = "El medio de pago seleccionado no es válido." });

        var transactions = await finance.ListAsync(
            salonId.Value, start, end, source ?? "all", status ?? "all", channel ?? "all", cancellationToken);
        return TypedResults.Ok(transactions);
    }

    private static async Task<IResult> RecordAppointmentPayment(
        Guid id,
        RecordLocalPaymentRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        if (request.PaymentChannel is not ("cash" or "transfer" or "debit" or "credit"))
            return TypedResults.BadRequest(new
            {
                message = "Elegí efectivo, transferencia, débito o crédito para registrar el cobro.",
            });

        var salonId = await GetSalonId(user, db, cancellationToken);
        if (salonId is null) return TypedResults.NotFound();

        await using var connection = (NpgsqlConnection)db.Create();
        var updated = await connection.ExecuteAsync(new CommandDefinition(
            """
            update public.appointments
            set payment_status = 'paid',
                payment_channel = @PaymentChannel,
                paid_at = coalesce(paid_at, now())
            where id = @Id and salon_id = @SalonId
              and status <> 'cancelled'
              and payment_method = 'salon'
              and payment_status = 'unpaid'
            """,
            new { Id = id, SalonId = salonId, request.PaymentChannel },
            cancellationToken: cancellationToken));
        if (updated == 1) return TypedResults.Ok(new { id });

        var state = await connection.QuerySingleOrDefaultAsync<AppointmentPayState>(new CommandDefinition(
            """
            select a.payment_method as "PaymentMethod", a.payment_status as "PaymentStatus", a.status as "Status"
            from public.appointments a where a.id = @Id and a.salon_id = @SalonId
            """, new { Id = id, SalonId = salonId }, cancellationToken: cancellationToken));
        if (state is null) return TypedResults.NotFound();
        loggerFactory.CreateLogger("Finance").LogWarning(
            "No se pudo registrar el pago del turno {AppointmentId}: method={Method}, payment={Payment}, status={Status}",
            id, state.PaymentMethod, state.PaymentStatus, state.Status);
        return TypedResults.Conflict(new
        {
            message = state.PaymentMethod == "mercadopago"
                ? "Los pagos de Mercado Pago se acreditan automáticamente."
                : state.PaymentStatus == "paid"
                    ? "Este turno ya figura como pagado."
                    : "No se puede cobrar un turno cancelado o con un estado no válido.",
        });
    }

    private sealed record AppointmentPayState(string PaymentMethod, string PaymentStatus, string Status);
}

public interface IFinanceService
{
    Task<IReadOnlyList<FinanceTransactionResponse>> ListAsync(
        Guid salonId, DateOnly from, DateOnly to, string source, string status, string channel,
        CancellationToken cancellationToken);
}

public sealed class FinanceService(IDbConnectionFactory db) : IFinanceService
{
    public async Task<IReadOnlyList<FinanceTransactionResponse>> ListAsync(
        Guid salonId, DateOnly from, DateOnly to, string source, string status, string channel,
        CancellationToken cancellationToken)
    {
        await using var connection = (NpgsqlConnection)db.Create();
        var transactions = await connection.QueryAsync<FinanceTransactionRow>(new CommandDefinition(
            """
            select a.id as "Id", 'appointment' as "Source",
                   coalesce(a.paid_at, a.starts_at) as "OccurredAt",
                   c.name as "CustomerName", sv.name as "Description",
                   st.display_name as "ProfessionalName", a.payment_amount as "Amount",
                   coalesce(a.payment_channel,
                     case when a.payment_method = 'mercadopago' then 'mercadopago' end) as "PaymentChannel",
                   a.payment_status as "PaymentStatus", a.status as "RecordStatus"
            from public.appointments a
            join public.customers c on c.id = a.customer_id
            join public.services sv on sv.id = a.service_id
            join public.staff st on st.id = a.staff_id
            where a.salon_id = @SalonId
              and coalesce(a.paid_at, a.starts_at) >= @From
              and coalesce(a.paid_at, a.starts_at) < @ToExclusive
              and (@Source = 'all' or @Source = 'appointment')
              and (@Status = 'all' or a.payment_status = @Status)
              and (
                @Channel = 'all'
                or (@Channel = 'salon' and coalesce(a.payment_channel,
                    case when a.payment_method = 'mercadopago' then 'mercadopago' end)
                    in ('cash', 'transfer', 'debit', 'credit', 'unknown'))
                or coalesce(a.payment_channel,
                    case when a.payment_method = 'mercadopago' then 'mercadopago' end) = @Channel
              )

            union all

            select o.id as "Id", 'product' as "Source",
                   coalesce(o.paid_at, o.created_at) as "OccurredAt",
                   o.customer_name as "CustomerName",
                   coalesce(items."Description", 'Pedido de tienda') as "Description",
                   null::text as "ProfessionalName",
                   coalesce(items."Amount", o.unit_price * o.quantity) as "Amount",
                   coalesce(o.payment_channel,
                     case when o.payment_method = 'mercadopago' then 'mercadopago' end) as "PaymentChannel",
                   o.payment_status as "PaymentStatus", o.status as "RecordStatus"
            from public.product_orders o
            left join lateral (
              select string_agg(i.product_name || ' × ' || i.quantity, ', ' order by i.product_name)
                       as "Description",
                     sum(i.quantity * i.unit_price) as "Amount"
              from public.product_order_items i
              where i.order_id = o.id
            ) items on true
            where o.salon_id = @SalonId
              and coalesce(o.paid_at, o.created_at) >= @From
              and coalesce(o.paid_at, o.created_at) < @ToExclusive
              and (@Source = 'all' or @Source = 'product')
              and (@Status = 'all' or o.payment_status = @Status)
              and (
                @Channel = 'all'
                or (@Channel = 'salon' and coalesce(o.payment_channel,
                    case when o.payment_method = 'mercadopago' then 'mercadopago' end)
                    in ('cash', 'transfer', 'debit', 'credit', 'unknown'))
                or coalesce(o.payment_channel,
                    case when o.payment_method = 'mercadopago' then 'mercadopago' end) = @Channel
              )
            order by "OccurredAt" desc
            limit 1000
            """,
            new
            {
                SalonId = salonId,
                From = from.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
                ToExclusive = to.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
                Source = source,
                Status = status,
                Channel = channel,
            },
            cancellationToken: cancellationToken));
        return transactions.Select(static transaction => transaction.ToResponse()).AsList();
    }

    private sealed record FinanceTransactionRow(
        Guid Id,
        string Source,
        DateTime OccurredAt,
        string CustomerName,
        string Description,
        string? ProfessionalName,
        decimal Amount,
        string? PaymentChannel,
        string PaymentStatus,
        string RecordStatus)
    {
        public FinanceTransactionResponse ToResponse() => new(
            Id,
            Source,
            new DateTimeOffset(DateTime.SpecifyKind(OccurredAt, DateTimeKind.Utc)),
            CustomerName,
            Description,
            ProfessionalName,
            Amount,
            PaymentChannel,
            PaymentStatus,
            RecordStatus);
    }
}

// medio de cobro en el salon
public sealed record RecordLocalPaymentRequest(string PaymentChannel);

// ingreso o pendiente
public sealed record FinanceTransactionResponse(
    Guid Id,
    string Source,
    DateTimeOffset OccurredAt,
    string CustomerName,
    string Description,
    string? ProfessionalName,
    decimal Amount,
    string? PaymentChannel,
    string PaymentStatus,
    string RecordStatus);
