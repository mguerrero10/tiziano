using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace StudentHub.Api;

public sealed class MercadoPagoService(
    HttpClient httpClient,
    IConfiguration configuration,
    ILogger<MercadoPagoService> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string? _accessToken = FirstConfig(
        configuration,
        "MERCADOPAGO_ACCESS_TOKEN",
        "MercadoPago:AccessToken");

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_accessToken);

    public bool IsTestCredentials =>
        _accessToken?.StartsWith("TEST-", StringComparison.OrdinalIgnoreCase) == true;

    public string PublicAppUrl =>
        (configuration["MercadoPago:PublicAppUrl"]
            ?? configuration["PUBLIC_APP_URL"]
            ?? "http://localhost:5173").TrimEnd('/');

    public string? PublicApiUrl
    {
        get
        {
            var value = configuration["MercadoPago:NotificationUrl"] ?? configuration["PUBLIC_API_URL"];
            return string.IsNullOrWhiteSpace(value) ? null : value.TrimEnd('/');
        }
    }

    public async Task<MercadoPagoPreference> CreatePreferenceAsync(
        MercadoPagoPreferenceRequest request,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();

        var itemCategory = string.IsNullOrWhiteSpace(request.ItemCategory) ? "services" : request.ItemCategory;
        var items = request.Items ?? [
            new MercadoPagoPreferenceItem(
                request.ItemId ?? request.ExternalReference,
                request.Title,
                request.Quantity <= 0 ? 1 : request.Quantity,
                request.Amount),
        ];
        var payload = new Dictionary<string, object?>
        {
            ["items"] = items.Select(item => new
            {
                id = item.Id,
                title = item.Title,
                description = request.Description,
                quantity = item.Quantity,
                currency_id = "ARS",
                unit_price = item.UnitPrice,
                category_id = itemCategory,
            }).ToArray(),
            ["payer"] = new
            {
                name = request.PayerName,
                email = request.PayerEmail,
            },
            ["external_reference"] = request.ExternalReference,
            ["statement_descriptor"] = "TURNO SALON",
            ["metadata"] = request.Metadata,
        };

        if (IsPublicHttpsUrl(request.SuccessUrl)
            && IsPublicHttpsUrl(request.FailureUrl)
            && IsPublicHttpsUrl(request.PendingUrl))
        {
            payload["back_urls"] = new
            {
                success = request.SuccessUrl,
                failure = request.FailureUrl,
                pending = request.PendingUrl,
            };
            payload["auto_return"] = "approved";
        }

        if (IsPublicHttpsUrl(request.NotificationUrl))
        {
            payload["notification_url"] = request.NotificationUrl;
        }

        var json = JsonSerializer.Serialize(payload, JsonOptions);
        logger.LogInformation(
            "Creando preferencia Mercado Pago ({ExternalReference}): {Payload}",
            request.ExternalReference,
            json);

        using var message = new HttpRequestMessage(HttpMethod.Post, "checkout/preferences")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        ApplyAuth(message);

        using var response = await httpClient.SendAsync(message, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        logger.LogInformation("Respuesta preferencia Mercado Pago ({Status}): {Body}", response.StatusCode, body);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(ParseError(body) ?? "No se pudo iniciar Mercado Pago.");
        }

        var parsed = JsonSerializer.Deserialize<PreferenceResponse>(body, JsonOptions)
            ?? throw new InvalidOperationException("Mercado Pago no devolvio la preferencia, mg se puso la gorra");

        var checkoutUrl = IsTestCredentials
            ? FirstNonEmpty(parsed.SandboxInitPoint, parsed.InitPoint)
            : FirstNonEmpty(parsed.InitPoint, parsed.SandboxInitPoint);
        logger.LogInformation(
            "Checkout Mercado Pago listo. preferenceId={PreferenceId} test={IsTest} url={CheckoutUrl}",
            parsed.Id,
            IsTestCredentials,
            checkoutUrl);
        if (string.IsNullOrWhiteSpace(parsed.Id) || string.IsNullOrWhiteSpace(checkoutUrl))
        {
            throw new InvalidOperationException("Mercado Pago no devolvio el link de pago.");
        }

        return new MercadoPagoPreference(parsed.Id, checkoutUrl);
    }

    public async Task<MercadoPagoPayment?> GetPaymentAsync(string paymentId, CancellationToken cancellationToken)
    {
        EnsureConfigured();
        if (string.IsNullOrWhiteSpace(paymentId))
        {
            return null;
        }

        var payment = await GetAsync<PaymentResponse>(
            $"v1/payments/{Uri.EscapeDataString(paymentId.Trim())}", cancellationToken);
        return MapPayment(payment);
    }

    public Task<MercadoPagoPayment?> FindPaymentByAppointmentAsync(
        Guid appointmentId,
        CancellationToken cancellationToken) =>
        FindPaymentByExternalReferenceAsync(appointmentId.ToString(), cancellationToken);

    public async Task<MercadoPagoPayment?> FindPaymentByExternalReferenceAsync(
        string externalReference,
        CancellationToken cancellationToken)
    {
        EnsureConfigured();
        if (string.IsNullOrWhiteSpace(externalReference))
        {
            return null;
        }

        var path =
            $"v1/payments/search?sort=date_created&criteria=desc&external_reference={Uri.EscapeDataString(externalReference.Trim())}";
        var parsed = await GetAsync<PaymentSearchResponse>(path, cancellationToken);
        return parsed?.Results?
            .Select(MapPayment)
            .FirstOrDefault(payment => payment is not null);
    }

    private async Task<T?> GetAsync<T>(string path, CancellationToken cancellationToken) where T : class
    {
        using var message = new HttpRequestMessage(HttpMethod.Get, path);
        ApplyAuth(message);

        using var response = await httpClient.SendAsync(message, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning(
                "No se pudo consultar Mercado Pago ({Path}, {Status}): {Body}",
                path,
                response.StatusCode,
                body);
            return null;
        }

        return JsonSerializer.Deserialize<T>(body, JsonOptions);
    }

    public static AppointmentPaymentOutcome MapStatus(string? status) => status switch
    {
        "approved" => new AppointmentPaymentOutcome("confirmed", "paid"),
        "pending" or "in_process" or "in_mediation" or "authorized" =>
            new AppointmentPaymentOutcome("pending", "pending"),
        "refunded" or "charged_back" => new AppointmentPaymentOutcome("cancelled", "refunded"),
        _ => new AppointmentPaymentOutcome("cancelled", "failed"),
    };

    private void EnsureConfigured()
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("Falta MERCADOPAGO_ACCESS_TOKEN en backend/.env");
        }
    }

    private void ApplyAuth(HttpRequestMessage message)
    {
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _accessToken);
    }

    private static MercadoPagoPayment? MapPayment(PaymentResponse? payment)
    {
        if (payment is null || payment.Id == 0)
        {
            return null;
        }

        var (appointmentId, productOrderId) = ParseExternalReference(payment.ExternalReference);
        return new MercadoPagoPayment(
            payment.Id.ToString(),
            payment.Status ?? "unknown",
            appointmentId,
            productOrderId,
            payment.TransactionAmount,
            payment.CurrencyId);
    }

    internal static (Guid? AppointmentId, Guid? ProductOrderId) ParseExternalReference(string? reference)
    {
        if (string.IsNullOrWhiteSpace(reference))
        {
            return (null, null);
        }

        var trimmed = reference.Trim();
        const string storePrefix = "store:";
        if (trimmed.StartsWith(storePrefix, StringComparison.OrdinalIgnoreCase)
            && Guid.TryParse(trimmed[storePrefix.Length..], out var orderId))
        {
            return (null, orderId);
        }

        if (Guid.TryParse(trimmed, out var appointmentId))
        {
            return (appointmentId, null);
        }

        return (null, null);
    }

    private static string? ParseError(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("message", out var message)
                && message.ValueKind == JsonValueKind.String)
            {
                return message.GetString();
            }
        }
        catch (JsonException)
        {
        }

        return null;
    }

    private static string? FirstConfig(IConfiguration configuration, params string[] keys) =>
        keys.Select(configuration.GetValue<string>).FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

    private static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));

    private static bool IsPublicHttpsUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && uri.Host is not ("localhost" or "127.0.0.1");

    private sealed record PreferenceResponse(
        [property: JsonPropertyName("id")] string? Id,
        [property: JsonPropertyName("init_point")] string? InitPoint,
        [property: JsonPropertyName("sandbox_init_point")] string? SandboxInitPoint);

    private sealed record PaymentSearchResponse(
        [property: JsonPropertyName("results")] List<PaymentResponse>? Results);

    private sealed record PaymentResponse(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("status")] string? Status,
        [property: JsonPropertyName("external_reference")] string? ExternalReference,
        [property: JsonPropertyName("transaction_amount")] decimal TransactionAmount,
        [property: JsonPropertyName("currency_id")] string? CurrencyId);
}

public sealed record MercadoPagoPreferenceRequest(
    string ExternalReference,
    string SalonSlug,
    string Title,
    string Description,
    decimal Amount,
    string PayerName,
    string PayerEmail,
    string SuccessUrl,
    string FailureUrl,
    string PendingUrl,
    DateTimeOffset ExpiresAt,
    string? NotificationUrl,
    string ItemCategory = "services",
    string? ItemId = null,
    int Quantity = 1,
    object? Metadata = null,
    IReadOnlyList<MercadoPagoPreferenceItem>? Items = null);

public sealed record MercadoPagoPreferenceItem(string Id, string Title, int Quantity, decimal UnitPrice);

public sealed record MercadoPagoPreference(string Id, string CheckoutUrl);

public sealed record MercadoPagoPayment(
    string Id, string Status, Guid? AppointmentId, Guid? ProductOrderId, decimal Amount, string? Currency);

public sealed record AppointmentPaymentOutcome(string AppointmentStatus, string PaymentStatus);
