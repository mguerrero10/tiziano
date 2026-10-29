using System.Text.Json;

namespace StudentHub.Api;

public sealed class YouCamStyleCache(HttpClient httpClient, IConfiguration configuration, ILogger<YouCamStyleCache> logger)
{
    private const string ApiBase = "https://yce-api-01.makeupar.com";

    private readonly string? _apiKey = configuration["YouCam:ApiKey"]
        ?? configuration["YOUCAM_API_KEY"]
        ?? configuration["PERFECTCORP_API_KEY"];

    private readonly SemaphoreSlim _gate = new(1, 1);
    private IReadOnlyList<HairStyleOption>? _styles;
    private IReadOnlyDictionary<int, YouCamStyleMapping>? _mappings;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_apiKey);

    public async Task<IReadOnlyList<HairStyleOption>> GetStylesAsync(CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            return [];
        }

        await EnsureLoadedAsync(cancellationToken);
        return _styles ?? [];
    }

    public async Task<YouCamStyleMapping?> ResolveAsync(int styleId, CancellationToken cancellationToken)
    {
        await EnsureLoadedAsync(cancellationToken);
        return _mappings?.GetValueOrDefault(styleId);
    }

    private async Task EnsureLoadedAsync(CancellationToken cancellationToken)
    {
        if (_styles is not null)
        {
            return;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_styles is not null)
            {
                return;
            }

            var templates = await GetHairTransferTemplatesAsync(cancellationToken);
            var options = new List<HairStyleOption>();
            var mappings = new Dictionary<int, YouCamStyleMapping>();
            var nextId = 1;

            foreach (var template in templates.OrderBy(template => ResolveGroup(template)).ThenBy(template => template.Title))
            {
                options.Add(new HairStyleOption(
                    nextId,
                    HairStyleTranslations.Translate(template.Title),
                    ResolveGroup(template),
                    template.ThumbUrl,
                    template.CategoryName));
                mappings[nextId] = new YouCamStyleMapping(template.Id);
                nextId++;
            }

            _styles = options;
            _mappings = mappings;
            logger.LogInformation("YouCam v2.1: cargados {Count} templates de peinado.", options.Count);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<IReadOnlyList<YouCamTemplateItem>> GetHairTransferTemplatesAsync(
        CancellationToken cancellationToken)
    {
        var templates = new List<YouCamTemplateItem>();
        string? startingToken = null;

        while (true)
        {
            var path = "/s2s/v2.1/task/template/hair-transfer?page_size=20";
            if (!string.IsNullOrWhiteSpace(startingToken))
            {
                path += $"&starting_token={Uri.EscapeDataString(startingToken)}";
            }

            using var response = await SendAsync(HttpMethod.Get, path, null, cancellationToken);
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            EnsureSuccess(body, response.StatusCode);

            using var document = JsonDocument.Parse(body);
            if (!document.RootElement.TryGetProperty("data", out var data))
            {
                break;
            }

            if (data.TryGetProperty("templates", out var templatesNode)
                && templatesNode.ValueKind == JsonValueKind.Array)
            {
                foreach (var template in templatesNode.EnumerateArray())
                {
                    if (!template.TryGetProperty("id", out var idNode))
                    {
                        continue;
                    }

                    var id = idNode.GetString();
                    if (string.IsNullOrWhiteSpace(id))
                    {
                        continue;
                    }

                    var title = template.TryGetProperty("title", out var titleNode)
                        ? titleNode.GetString() ?? "Estilo"
                        : "Estilo";
                    var thumbUrl = template.TryGetProperty("thumb", out var thumbNode)
                        ? thumbNode.GetString()
                        : null;
                    var categoryName = template.TryGetProperty("category_name", out var categoryNode)
                        ? categoryNode.GetString() ?? "Estilos"
                        : "Estilos";
                    templates.Add(new YouCamTemplateItem(id, title, thumbUrl, categoryName));
                }
            }

            if (!data.TryGetProperty("next_token", out var nextTokenNode))
            {
                break;
            }

            startingToken = nextTokenNode.GetString();
            if (string.IsNullOrWhiteSpace(startingToken))
            {
                break;
            }
        }

        return templates;
    }

    private static string ResolveGroup(YouCamTemplateItem template)
    {
        if (template.Id.StartsWith("male_", StringComparison.OrdinalIgnoreCase))
        {
            return "Masculino";
        }

        if (template.Id.StartsWith("female_", StringComparison.OrdinalIgnoreCase))
        {
            return "Femenino";
        }

        return template.CategoryName.Contains("male", StringComparison.OrdinalIgnoreCase)
            && !template.CategoryName.Contains("female", StringComparison.OrdinalIgnoreCase)
            ? "Masculino"
            : "Femenino";
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method,
        string path,
        object? payload,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, ApiBase + path);
        request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {_apiKey}");
        if (payload is not null)
        {
            request.Content = JsonContent.Create(payload);
        }

        return await httpClient.SendAsync(request, cancellationToken);
    }

    private static void EnsureSuccess(string body, System.Net.HttpStatusCode statusCode)
    {
        if ((int)statusCode is >= 200 and < 300)
        {
            return;
        }

        throw new InvalidOperationException(ParseErrorMessage(body, statusCode));
    }

    private static string ParseErrorMessage(string body, System.Net.HttpStatusCode statusCode)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("error", out var error))
            {
                return error.GetString() ?? $"YouCam respondió {(int)statusCode}.";
            }

            if (document.RootElement.TryGetProperty("message", out var message))
            {
                return message.GetString() ?? $"YouCam respondió {(int)statusCode}.";
            }
        }
        catch
        {
            // ignore parse errors
        }

        return $"YouCam respondió {(int)statusCode}.";
    }

    private sealed record YouCamTemplateItem(
        string Id,
        string Title,
        string? ThumbUrl,
        string CategoryName);
}

public sealed record YouCamStyleMapping(string TemplateId);
