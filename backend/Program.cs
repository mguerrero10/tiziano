using System.Security.Claims;
using System.Threading.RateLimiting;
using Dapper;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using StudentHub.Api;
using StudentHub.Api.Data;

EnvFile.Load(
    Path.Combine(Directory.GetCurrentDirectory(), ".env"),
    Path.Combine(Directory.GetCurrentDirectory(), "backend", ".env"));

var builder = WebApplication.CreateBuilder(args);

EnvFile.Load(Path.Combine(builder.Environment.ContentRootPath, ".env"));
builder.Configuration.AddEnvironmentVariables();

var supabaseUrl = builder.Configuration["Supabase:Url"]
    ?? throw new InvalidOperationException("Falta Supabase:Url.");

builder.Services.AddSingleton<IDbConnectionFactory, DbConnectionFactory>();
builder.Services.AddScoped<IProductOrderService, ProductOrderService>();
builder.Services.AddScoped<IFinanceService, FinanceService>();
builder.Services.AddSingleton<YouCamStyleCache>();
builder.Services.AddScoped<HairPreviewService>();
builder.Services.AddHttpClient<YouCamHairPreviewService>(client =>
{
    client.Timeout = TimeSpan.FromMinutes(3);
});
builder.Services.AddHttpClient<YouCamStyleCache>(client =>
{
    client.Timeout = TimeSpan.FromMinutes(2);
});
builder.Services.AddHttpClient<MercadoPagoService>(client =>
{
    client.BaseAddress = new Uri("https://api.mercadopago.com/");
    client.Timeout = TimeSpan.FromSeconds(30);
});
builder.Services.AddHttpClient<WhatsAppService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(30);
});
builder.Services.AddHostedService<WhatsAppReminderHostedService>();

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
            ?? ["http://localhost:5173"];

        policy.WithOrigins(origins)
            .AllowAnyHeader()
            .AllowAnyMethod();

        if (builder.Environment.IsDevelopment())
        {
            policy.SetIsOriginAllowed(origin =>
                Uri.TryCreate(origin, UriKind.Absolute, out var uri)
                && uri.Host is "localhost" or "127.0.0.1");
        }
    });
});

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MetadataAddress = $"{supabaseUrl.TrimEnd('/')}/auth/v1/.well-known/openid-configuration";
        options.Audience = "authenticated";
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = $"{supabaseUrl.TrimEnd('/')}/auth/v1",
            ValidateAudience = true,
            ValidAudience = "authenticated",
            ValidateLifetime = true,
            NameClaimType = "sub",
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, token) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            context.HttpContext.Response.Headers.RetryAfter =
                ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
        }

        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await context.HttpContext.Response.WriteAsJsonAsync(
            new { message = "Demasiados intentos. Esperá un minuto e intentá de nuevo.", retryAfterSeconds = 60 },
            cancellationToken: token);
    };
    options.AddFixedWindowLimiter("public-booking", limiter =>
    {
        limiter.PermitLimit = 10;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 0;
        limiter.AutoReplenishment = true;
    });
    options.AddFixedWindowLimiter("hair-preview", limiter =>
    {
        limiter.PermitLimit = 3;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 0;
        limiter.AutoReplenishment = true;
    });
});

var app = builder.Build();

app.UseCors();

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapGet("/api/health", async (IDbConnectionFactory db, CancellationToken cancellationToken) =>
{
    if (!db.IsConfigured)
    {
        return Results.Ok(new
        {
            ok = true,
            api = true,
            database = "pending",
            hint = "Pegá SUPABASE_DB_PASSWORD en backend/.env (Supabase → Settings → Database)."
        });
    }

    try
    {
        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        var result = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition("select 1", cancellationToken: cancellationToken));

        return Results.Ok(new { ok = result == 1, api = true, database = "supabase" });
    }
    catch (Exception ex)
    {
        return Results.Ok(new
        {
            ok = false,
            api = true,
            database = "error",
            hint = ex.Message
        });
    }
});

app.MapGet("/api/me", async (ClaimsPrincipal user, IDbConnectionFactory db, CancellationToken cancellationToken) =>
{
    var id = user.FindFirstValue("sub");
    var email = user.FindFirstValue("email");
    var role = user.FindFirstValue("role");

    Guid.TryParse(id, out var userId);
    var platformAdmin = false;
    var hasSalon = false;
    string[] enabledModules = [];
    MeSalonRow? salon = null;
    if (userId != Guid.Empty && db.IsConfigured)
    {
        try
        {
            platformAdmin = await PlatformEndpoints.IsPlatformAdmin(userId, db, cancellationToken);
            await using var connection = (NpgsqlConnection)db.Create();
            await connection.OpenAsync(cancellationToken);

            var salonId = await connection.ExecuteScalarAsync<Guid?>(
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

            hasSalon = salonId is not null;

            if (salonId is not null)
            {
                try
                {
                    salon = await connection.QuerySingleOrDefaultAsync<MeSalonRow>(
                        new CommandDefinition(
                            """
                            select s.id as "Id", s.name as "Name", s.slug as "Slug",
                                   s.logo_url as "LogoUrl", s.store_enabled as "StoreEnabled"
                            from public.salons s
                            where s.id = @SalonId
                            """,
                            new { SalonId = salonId },
                            cancellationToken: cancellationToken));
                }
                catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UndefinedColumn)
                {
                    salon = await connection.QuerySingleOrDefaultAsync<MeSalonRow>(
                        new CommandDefinition(
                            """
                            select s.id as "Id", s.name as "Name", s.slug as "Slug",
                                   s.logo_url as "LogoUrl", true as "StoreEnabled"
                            from public.salons s
                            where s.id = @SalonId
                            """,
                            new { SalonId = salonId },
                            cancellationToken: cancellationToken));
                }

                enabledModules = (await connection.QueryAsync<string>(
                    new CommandDefinition(
                        """
                        select sm.module_key
                        from public.salon_modules sm
                        join public.platform_modules pm on pm.key = sm.module_key
                        where sm.salon_id = @SalonId and sm.enabled and pm.active
                        order by pm.sort_order
                        """,
                        new { SalonId = salonId },
                        cancellationToken: cancellationToken))).AsList().ToArray();
            }
        }
        catch
        {
            // TO DO Manejar el catchhh no olvidarrrrr
        }
    }

    return Results.Ok(new { id, email, role, platformAdmin, hasSalon, enabledModules, salon });
}).RequireAuthorization();

app.MapSalonEndpoints();
app.MapPlatformEndpoints();

app.Run();

file sealed record MeSalonRow(Guid Id, string Name, string Slug, string? LogoUrl, bool StoreEnabled);
