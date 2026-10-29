using System.Net.Http.Headers;
using System.Text.Json;

namespace StudentHub.Api;

public sealed class YouCamHairPreviewService(
    HttpClient httpClient,
    IConfiguration configuration,
    YouCamStyleCache styleCache,
    ILogger<YouCamHairPreviewService> logger)
{
    private const string ApiBase = "https://yce-api-01.makeupar.com";

    private readonly string? _apiKey = configuration["YouCam:ApiKey"]
        ?? configuration["YOUCAM_API_KEY"]
        ?? configuration["PERFECTCORP_API_KEY"];

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_apiKey);

    public async Task<HairPreviewResponse> GenerateAsync(
        string imageBase64,
        string mimeType,
        int styleId,
        string? referenceImageBase64,
        string? referenceMimeType,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
        {
            throw new InvalidOperationException("Falta YOUCAM_API_KEY");
        }

        var bytes = Convert.FromBase64String(imageBase64);
        var normalizedMime = NormalizeMimeType(mimeType);
        var fileName = normalizedMime == "image/png" ? "selfie.png" : "selfie.jpg";
        var srcFileId = await UploadFileAsync(bytes, normalizedMime, fileName, cancellationToken);

        var customReference = !string.IsNullOrWhiteSpace(referenceImageBase64);
        string? refFileId = null;
        string? templateId = null;

        if (!string.IsNullOrWhiteSpace(referenceImageBase64))
        {
            var referenceBase64 = referenceImageBase64.Trim();
            if (referenceBase64.Contains(','))
            {
                referenceBase64 = referenceBase64.Split(',', 2)[1];
            }

            var referenceBytes = Convert.FromBase64String(referenceBase64);
            var normalizedReferenceMime = NormalizeMimeType(referenceMimeType ?? "image/jpeg");
            var referenceFileName = normalizedReferenceMime == "image/png" ? "reference.png" : "reference.jpg";
            refFileId = await UploadFileAsync(
                referenceBytes,
                normalizedReferenceMime,
                referenceFileName,
                cancellationToken);
        }
        else
        {
            var mapping = await styleCache.ResolveAsync(styleId, cancellationToken)
                ?? throw new ArgumentException("Elegí un estilo de corte válido.");

            templateId = mapping.TemplateId;
        }

        //existe data , existe task id y si el id no esta vacio

        object payload = customReference
            ? new { src_file_id = srcFileId, ref_file_id = refFileId }
            : new { src_file_id = srcFileId, template_id = templateId };
        using var task = await SendAsync(
            HttpMethod.Post, "/s2s/v2.1/task/hair-transfer", payload, cancellationToken);
        if (!task.RootElement.TryGetProperty("data", out var taskData)
            || !taskData.TryGetProperty("task_id", out var taskIdNode)
            || string.IsNullOrWhiteSpace(taskIdNode.GetString()))
        {
            throw new InvalidOperationException("YouCam no inició la tarea de peinado.");
        }

        var taskId = taskIdNode.GetString()!;
        var resultUrl = await PollTaskResultAsync(taskId, cancellationToken);
        var (resultMime, resultBase64) = await DownloadAsBase64Async(resultUrl, cancellationToken);
        logger.LogInformation("YouCam generó la vista previa {TaskId}.", taskId);
        return new HairPreviewResponse(resultMime, resultBase64, customReference ? "youcam-custom" : "youcam");
    }

    private async Task<string> UploadFileAsync(
        byte[] bytes,
        string mimeType,
        string fileName,
        CancellationToken cancellationToken)
    {
        using var document = await SendAsync(
            HttpMethod.Post,
            "/s2s/v2.0/file",
            new
            {
                files = new[]
                {
                    new
                    {
                        content_type = mimeType,
                        file_name = fileName,
                        file_size = bytes.Length,
                    },
                },
            },
            cancellationToken);
        if (!document.RootElement.TryGetProperty("data", out var data)
            || !data.TryGetProperty("files", out var files)
            || files.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException("YouCam no devolvió datos de subida.");
        }

        var fileNode = files.EnumerateArray().FirstOrDefault();
        if (fileNode.ValueKind == JsonValueKind.Undefined
            || !fileNode.TryGetProperty("file_id", out var fileIdNode)
            || !fileNode.TryGetProperty("requests", out var requests)
            || requests.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException("YouCam no devolvió file_id.");
        }

        var uploadNode = requests.EnumerateArray().FirstOrDefault();
        if (uploadNode.ValueKind != JsonValueKind.Object
            || !uploadNode.TryGetProperty("url", out var urlNode)
            || !uploadNode.TryGetProperty("method", out var methodNode))
        {
            throw new InvalidOperationException("YouCam no devolvió URL de subida.");
        }

        var uploadUrl = urlNode.GetString();
        if (string.IsNullOrWhiteSpace(uploadUrl))
        {
            throw new InvalidOperationException("YouCam devolvió una URL de subida vacía.");
        }

        using var uploadRequest = new HttpRequestMessage(
            new HttpMethod(methodNode.GetString() ?? "PUT"),
            uploadUrl);
        uploadRequest.Content = new ByteArrayContent(bytes);
        uploadRequest.Content.Headers.ContentType = new MediaTypeHeaderValue(mimeType);

        using var uploadResponse = await httpClient.SendAsync(uploadRequest, cancellationToken);
        if (!uploadResponse.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"YouCam rechazó la subida ({(int)uploadResponse.StatusCode}).");
        }

        return fileIdNode.GetString()
            ?? throw new InvalidOperationException("YouCam no devolvió file_id.");
    }

    private async Task<string> PollTaskResultAsync(string taskId, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 60; attempt++)
        {
            using var document = await SendAsync(
                HttpMethod.Get,
                $"/s2s/v2.1/task/hair-transfer/{Uri.EscapeDataString(taskId)}",
                null,
                cancellationToken);
            if (!document.RootElement.TryGetProperty("data", out var data))
            {
                throw new InvalidOperationException("YouCam no devolvió estado de tarea.");
            }

            var status = data.TryGetProperty("task_status", out var statusNode)
                ? statusNode.GetString()
                : null;

            if (status == "success")
            {
                var url = ExtractResultUrl(data);
                if (!string.IsNullOrWhiteSpace(url))
                {
                    return url;
                }

                throw new InvalidOperationException("YouCam completo pero no devolvio la img.");
            }

            if (status == "error")
            {
                var error = data.TryGetProperty("error", out var errorNode)
                    ? errorNode.GetString()
                    : "Error desconocido";
                if (string.Equals(error, "error_no_face", StringComparison.OrdinalIgnoreCase))
                {
                    throw new ArgumentException(
                        "no se encontro rostro");
                }

                var message = data.TryGetProperty("error_message", out var messageNode)
                    ? messageNode.GetString()
                    : null;
                throw new InvalidOperationException(
                    string.IsNullOrWhiteSpace(message)
                        ? $"YouCam no pudo generar la vista previa: {error}"
                        : message);
            }

            await Task.Delay(1000, cancellationToken);
        }

        throw new InvalidOperationException("YouCam se tardo mucho");
    }

    private static string? ExtractResultUrl(JsonElement data)
    {
        if (!data.TryGetProperty("results", out var results))
        {
            return null;
        }

        if (results.ValueKind == JsonValueKind.Object
            && results.TryGetProperty("url", out var directUrlNode))
        {
            return directUrlNode.GetString();
        }

        return null;
    }

    private async Task<(string MimeType, string Base64)> DownloadAsBase64Async(
        string url,
        CancellationToken cancellationToken)
    {
        using var response = await httpClient.GetAsync(url, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("No se pudo descargar la imagen generada por YouCam.");
        }

        var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        var mimeType = response.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
        return (mimeType, Convert.ToBase64String(bytes));
    }

    private async Task<JsonDocument> SendAsync(
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

        using var response = await httpClient.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(ParseErrorMessage(body, response.StatusCode));
        }

        return JsonDocument.Parse(body);
    }

    private static string NormalizeMimeType(string mimeType) =>
        mimeType.Trim().ToLowerInvariant() switch
        {
            "image/png" => "image/png",
            _ => "image/jpeg",
        };

    private string ParseErrorMessage(string body, System.Net.HttpStatusCode statusCode)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("error", out var error))
            {
                return error.GetString() ?? $"YouCam devolvio {(int)statusCode}.";
            }

            if (document.RootElement.TryGetProperty("message", out var message))
            {
                return message.GetString() ?? $"YouCam devolvio {(int)statusCode}.";
            }
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "YouCam devolvio {StatusCode}.", (int)statusCode);
        }

        return $"YouCam devolvio {(int)statusCode}.";
    }
}
