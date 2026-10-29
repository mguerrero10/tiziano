namespace StudentHub.Api;

public sealed class HairPreviewService(
    YouCamHairPreviewService youcam)
{
    public bool IsConfigured => youcam.IsConfigured;

    public async Task<HairPreviewResponse> GenerateAsync(
        HairPreviewRequest request,
        CancellationToken cancellationToken)
    {
        var hasCustomReference = !string.IsNullOrWhiteSpace(request.ReferenceImageBase64);
        if (!hasCustomReference && request.StyleId <= 0)
        {
            throw new ArgumentException("Elegí un estilo de corte válido.");
        }

        return await youcam.GenerateAsync(
            request.ImageBase64,
            request.MimeType,
            request.StyleId,
            request.ReferenceImageBase64,
            request.ReferenceMimeType,
            cancellationToken);
    }
}
