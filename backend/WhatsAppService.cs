using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace StudentHub.Api;

public sealed class WhatsAppService(
    HttpClient httpClient,
    IConfiguration configuration,
    ILogger<WhatsAppService> logger)
{
    private const string GraphVersion = "v21.0";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string? _accessToken = FirstConfig(
        configuration,
        "WHATSAPP_ACCESS_TOKEN",
        "WhatsApp:AccessToken");

    private readonly string? _phoneNumberId = FirstConfig(
        configuration,
        "WHATSAPP_PHONE_NUMBER_ID",
        "WhatsApp:PhoneNumberId");

    private readonly string? _confirmationTemplate = FirstConfig(
        configuration,
        "WHATSAPP_TEMPLATE_CONFIRMATION",
        "WhatsApp:TemplateConfirmation");

    private readonly string? _reminderTemplate = FirstConfig(
        configuration,
        "WHATSAPP_TEMPLATE_REMINDER",
        "WhatsApp:TemplateReminder");

    private readonly string _languageCode =
        FirstConfig(configuration, "WHATSAPP_LANGUAGE", "WhatsApp:Language") ?? "es";

    public double ReminderHoursBefore { get; } = ParseReminderHours(configuration);

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(_accessToken)
        && !string.IsNullOrWhiteSpace(_phoneNumberId)
        && !string.IsNullOrWhiteSpace(_confirmationTemplate);

    public bool IsReminderConfigured =>
        IsConfigured && !string.IsNullOrWhiteSpace(_reminderTemplate);

    // confirmacion_turno: nombre, fecha, servicio, numero, salon
    public async Task<bool> TrySendAppointmentConfirmationAsync(
        Guid appointmentId,
        string customerPhone,
        string customerName,
        string salonName,
        string serviceName,
        DateTime startsAtUtc,
        string timezoneId,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            return false;
        }

        var to = NormalizeToE164(customerPhone);
        if (to is null)
        {
            logger.LogWarning("WhatsApp: teléfono inválido para confirmación ({Phone})", customerPhone);
            return false;
        }

        var localStart = ToLocal(startsAtUtc, timezoneId);
        // Plantillas de utilidad: cada variable de texto máx. 30 caracteres (Meta).
        var whenText = localStart.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);
        var confirmationCode = FormatConfirmationCode(appointmentId);

        var bodyParameters = new[]
        {
            TrimParameter(customerName),
            TrimParameter(whenText),
            TrimParameter(serviceName),
            TrimParameter(confirmationCode),
            TrimParameter(salonName),
        };

        return await SendTemplateAsync(to, _confirmationTemplate!, bodyParameters, cancellationToken);
    }

    // recordatorio_turno: nombre, salon, fecha, hora
    public async Task<bool> TrySendAppointmentReminderAsync(
        string customerPhone,
        string customerName,
        string salonName,
        DateTime startsAtUtc,
        string timezoneId,
        CancellationToken cancellationToken)
    {
        if (!IsReminderConfigured)
        {
            return false;
        }

        var to = NormalizeToE164(customerPhone);
        if (to is null)
        {
            logger.LogWarning("WhatsApp: teléfono inválido para recordatorio ({Phone})", customerPhone);
            return false;
        }

        var localStart = ToLocal(startsAtUtc, timezoneId);
        var dateText = localStart.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);
        var timeText = localStart.ToString("HH:mm", CultureInfo.InvariantCulture);

        var bodyParameters = new[]
        {
            TrimParameter(customerName),
            TrimParameter(salonName),
            TrimParameter(dateText),
            TrimParameter(timeText),
        };

        return await SendTemplateAsync(to, _reminderTemplate!, bodyParameters, cancellationToken);
    }

    private async Task<bool> SendTemplateAsync(
        string to,
        string templateName,
        IReadOnlyList<string> bodyParameters,
        CancellationToken cancellationToken)
    {
        var url = $"https://graph.facebook.com/{GraphVersion}/{_phoneNumberId}/messages";
        var payload = new
        {
            messaging_product = "whatsapp",
            to,
            type = "template",
            template = new
            {
                name = templateName,
                language = new { code = _languageCode },
                components = new object[]
                {
                    new
                    {
                        type = "body",
                        parameters = bodyParameters.Select(text => new { type = "text", text }).ToArray(),
                    },
                },
            },
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _accessToken);
        request.Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json");

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning(
                "WhatsApp: falló el envío ({Status}): {Body}",
                (int)response.StatusCode,
                body);
            return false;
        }

        logger.LogInformation("WhatsApp: plantilla {Template} enviada a {To}", templateName, to);
        return true;
    }

    internal static string? NormalizeToE164(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var digits = new string(raw.Where(char.IsDigit).ToArray());
        if (digits.Length == 0)
        {
            return null;
        }

        if (digits.StartsWith("549", StringComparison.Ordinal) && digits.Length is >= 12 and <= 13)
        {
            return digits;
        }

        if (digits.StartsWith('0'))
        {
            digits = digits.TrimStart('0');
        }

        if (digits.StartsWith("54", StringComparison.Ordinal))
        {
            if (digits.StartsWith("5415", StringComparison.Ordinal))
            {
                digits = "549" + digits[4..];
            }
            else if (!digits.StartsWith("549", StringComparison.Ordinal))
            {
                digits = "549" + digits[2..];
            }

            return digits.Length is >= 12 and <= 13 ? digits : null;
        }

        if (digits.StartsWith("15", StringComparison.Ordinal) && digits.Length is >= 10 and <= 11)
        {
            digits = "549" + digits[2..];
            return digits;
        }

        if (digits.Length is >= 8 and <= 11)
        {
            digits = "549" + digits;
            return digits.Length is >= 12 and <= 13 ? digits : null;
        }

        return null;
    }

    private static string FormatConfirmationCode(Guid appointmentId) =>
        appointmentId.ToString("N")[..8].ToUpperInvariant();

    private static DateTime ToLocal(DateTime startsAtUtc, string timezoneId)
    {
        var timezone = ResolveTimeZone(timezoneId);
        return TimeZoneInfo.ConvertTimeFromUtc(startsAtUtc, timezone);
    }

    private const int UtilityTemplateParamMaxLength = 30;

    private static string TrimParameter(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length <= UtilityTemplateParamMaxLength
            ? trimmed
            : trimmed[..UtilityTemplateParamMaxLength];
    }

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

    private static double ParseReminderHours(IConfiguration configuration)
    {
        var raw = configuration["WHATSAPP_REMINDER_HOURS_BEFORE"]
            ?? configuration["WhatsApp:ReminderHoursBefore"];
        return double.TryParse(raw, System.Globalization.NumberStyles.Float, CultureInfo.InvariantCulture, out var hours)
            && hours is > 0 and <= 168
            ? hours
            : 24;
    }

    private static string? FirstConfig(IConfiguration configuration, string envKey, string configKey)
    {
        var value = configuration[envKey] ?? configuration[configKey];
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
