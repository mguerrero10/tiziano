namespace StudentHub.Api;

public sealed record HairStyleOption(
    int Id,
    string Name,
    string Group,
    string? ThumbUrl = null,
    string? Category = null);

public sealed record HairPreviewResponse(string MimeType, string ImageBase64, string Provider);

public sealed record HairPreviewRequest(
    Guid AppointmentId,
    string ImageBase64,
    string MimeType,
    int StyleId,
    string? StyleNotes,
    string? ReferenceImageBase64 = null,
    string? ReferenceMimeType = null);
