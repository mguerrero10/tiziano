using Dapper;
using Npgsql;
using StudentHub.Api.Data;

namespace StudentHub.Api;

public sealed class WhatsAppReminderHostedService(
    IServiceProvider services,
    ILogger<WhatsAppReminderHostedService> logger) : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessRemindersAsync(stoppingToken);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogError(exception, "error job de recordatorios");
            }

            await Task.Delay(PollInterval, stoppingToken);
        }
    }

    private async Task ProcessRemindersAsync(CancellationToken cancellationToken)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<IDbConnectionFactory>();
        var whatsApp = scope.ServiceProvider.GetRequiredService<WhatsAppService>();

        if (!db.IsConfigured || !whatsApp.IsReminderConfigured)
        {
            return;
        }

        var hoursBefore = whatsApp.ReminderHoursBefore;
        var windowStart = DateTime.UtcNow.AddHours(hoursBefore - 0.5);
        var windowEnd = DateTime.UtcNow.AddHours(hoursBefore + 0.5);

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);

        IReadOnlyList<WhatsAppReminderRow> due;
        try
        {
            due = (await connection.QueryAsync<WhatsAppReminderRow>(
                new CommandDefinition(
                    """
                    select a.id as "Id", c.name as "CustomerName", c.phone as "CustomerPhone",
                           s.name as "SalonName", a.starts_at as "StartsAt", s.timezone as "Timezone"
                    from public.appointments a
                    join public.customers c on c.id = a.customer_id
                    join public.salons s on s.id = a.salon_id
                    where a.status = 'confirmed'
                      and a.payment_status <> 'pending'
                      and a.starts_at >= @WindowStart
                      and a.starts_at < @WindowEnd
                      and a.whatsapp_reminder_sent_at is null
                    order by a.starts_at
                    limit 50
                    """,
                    new { WindowStart = windowStart, WindowEnd = windowEnd },
                    cancellationToken: cancellationToken))).AsList();
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UndefinedColumn)
        {
            return;
        }

        foreach (var row in due)
        {
            var sent = await whatsApp.TrySendAppointmentReminderAsync(
                row.CustomerPhone,
                row.CustomerName,
                row.SalonName,
                row.StartsAt,
                row.Timezone,
                cancellationToken);

            if (!sent)
            {
                continue;
            }

            try
            {
                await connection.ExecuteAsync(
                    new CommandDefinition(
                        """
                        update public.appointments
                        set whatsapp_reminder_sent_at = now()
                        where id = @Id and whatsapp_reminder_sent_at is null
                        """,
                        new { row.Id },
                        cancellationToken: cancellationToken));
            }
            catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UndefinedColumn)
            {
                return;
            }
        }
    }

    private sealed record WhatsAppReminderRow(
        Guid Id,
        string CustomerName,
        string CustomerPhone,
        string SalonName,
        DateTime StartsAt,
        string Timezone);
}
