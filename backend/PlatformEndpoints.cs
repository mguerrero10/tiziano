using System.Data;
using System.Security.Claims;
using System.Text.RegularExpressions;
using Dapper;
using Npgsql;
using StudentHub.Api.Data;

namespace StudentHub.Api;

public static class PlatformEndpoints
{
    private static readonly Regex SlugPattern = new("^[a-z0-9]+(?:-[a-z0-9]+)*$", RegexOptions.Compiled);

    public static IEndpointRouteBuilder MapPlatformEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/platform/dashboard", GetDashboard).RequireAuthorization();
        app.MapGet("/api/platform/modules", GetModuleCatalog).RequireAuthorization();
        app.MapGet("/api/platform/salons", ListSalons).RequireAuthorization();
        app.MapPost("/api/platform/salons", CreateSalon).RequireAuthorization();
        app.MapPatch("/api/platform/salons/{id:guid}", UpdateSalon).RequireAuthorization();
        app.MapPost("/api/platform/salons/{id:guid}/owner/password", ResetOwnerPassword).RequireAuthorization();
        app.MapPatch("/api/platform/salons/{id:guid}/modules/{moduleKey}", SetSalonModule).RequireAuthorization();
        return app;
    }

    private static async Task<IResult> GetDashboard(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!await EnsurePlatformAdmin(user, db, cancellationToken))
        {
            return Results.Forbid();
        }

        await using var connection = (NpgsqlConnection)db.Create();
        using var result = await connection.QueryMultipleAsync(
            new CommandDefinition(
                """
                select
                  (select count(*)::int from public.salons) as "TotalSalons",
                  (select count(*)::int from public.salons where active) as "ActiveSalons",
                  (select count(*)::int from public.customers) as "TotalCustomers",
                  (
                    select count(*)::int
                    from public.appointments
                    where date_trunc('month', starts_at) = date_trunc('month', now())
                  ) as "AppointmentsThisMonth",
                  (
                    select count(*)::int
                    from public.salon_modules
                    where enabled
                  ) as "EnabledModules";

                select pm.key as "Key", pm.name as "Name", count(sm.salon_id)::int as "SalonCount"
                from public.platform_modules pm
                left join public.salon_modules sm
                  on sm.module_key = pm.key and sm.enabled
                where pm.active
                group by pm.key, pm.name, pm.sort_order
                order by pm.sort_order;
                """,
                cancellationToken: cancellationToken));

        var summary = await result.ReadSingleAsync<PlatformSummary>();
        var modules = (await result.ReadAsync<PlatformModuleUsage>()).AsList();
        return Results.Ok(new { summary, modules });
    }

    private static async Task<IResult> GetModuleCatalog(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!await EnsurePlatformAdmin(user, db, cancellationToken))
        {
            return Results.Forbid();
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var modules = await connection.QueryAsync<PlatformModule>(
            new CommandDefinition(
                """
                select key as "Key", name as "Name", description as "Description", sort_order as "SortOrder"
                from public.platform_modules
                where active
                order by sort_order
                """,
                cancellationToken: cancellationToken));

        return Results.Ok(modules);
    }

    private static async Task<IResult> ListSalons(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!await EnsurePlatformAdmin(user, db, cancellationToken))
        {
            return Results.Forbid();
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var salons = (await connection.QueryAsync<PlatformSalonRow>(
            new CommandDefinition(
                """
                select
                  s.id as "Id",
                  s.name as "Name",
                  s.slug as "Slug",
                  s.phone as "Phone",
                  s.address as "Address",
                  s.active as "Active",
                  s.logo_url as "LogoUrl",
                  s.created_at as "CreatedAt",
                  owner_profile.display_name as "OwnerName",
                  coalesce(owner_profile.email, owner_auth.email) as "OwnerEmail",
                  (
                    select count(*)::int
                    from public.customers c
                    where c.salon_id = s.id
                  ) as "CustomerCount",
                  (
                    select count(*)::int
                    from public.appointments a
                    where a.salon_id = s.id
                      and a.status in ('pending', 'confirmed')
                      and a.starts_at >= now()
                  ) as "UpcomingCount"
                from public.salons s
                left join public.salon_members sm
                  on sm.salon_id = s.id and sm.role = 'owner'
                left join public.profiles owner_profile on owner_profile.id = sm.user_id
                left join auth.users owner_auth on owner_auth.id = sm.user_id
                order by s.created_at desc
                """,
                cancellationToken: cancellationToken))).AsList();

        var moduleRows = (await connection.QueryAsync<SalonModuleRow>(
            new CommandDefinition(
                """
                select sm.salon_id as "SalonId", sm.module_key as "ModuleKey", sm.enabled as "Enabled"
                from public.salon_modules sm
                join public.platform_modules pm on pm.key = sm.module_key and pm.active
                order by pm.sort_order
                """,
                cancellationToken: cancellationToken))).AsList();

        var modulesBySalon = moduleRows
            .GroupBy(row => row.SalonId)
            .ToDictionary(
                group => group.Key,
                group => group.Select(row => new SalonModuleState(row.ModuleKey, row.Enabled)).ToArray());

        var response = salons.Select(salon => new
        {
            salon.Id,
            salon.Name,
            salon.Slug,
            salon.Phone,
            salon.Address,
            salon.Active,
            salon.LogoUrl,
            salon.CreatedAt,
            salon.OwnerName,
            salon.OwnerEmail,
            salon.CustomerCount,
            salon.UpcomingCount,
            modules = modulesBySalon.GetValueOrDefault(salon.Id, [])
        });

        return Results.Ok(response);
    }

    private static async Task<IResult> CreateSalon(
        ClaimsPrincipal user,
        CreateSalonRequest request,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!await EnsurePlatformAdmin(user, db, cancellationToken))
        {
            return Results.Forbid();
        }

        var name = request.Name?.Trim() ?? "";
        var slug = (request.Slug ?? "").Trim().ToLowerInvariant();
        var ownerEmail = request.OwnerEmail?.Trim().ToLowerInvariant() ?? "";
        var ownerPassword = request.OwnerPassword ?? "";

        if (name.Length == 0 || !SlugPattern.IsMatch(slug) || ownerEmail.Length == 0)
        {
            return Results.BadRequest(new
            {
                message = "Nombre, slug (minúsculas-con-guiones) y email del titular son obligatorios."
            });
        }

        if (ownerPassword.Length < 6)
        {
            return Results.BadRequest(new { message = "La contraseña inicial debe tener al menos 6 caracteres." });
        }

        Guid.TryParse(user.FindFirstValue("sub"), out var adminId);

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var displayName = string.IsNullOrWhiteSpace(request.OwnerName)
                ? name
                : request.OwnerName.Trim();
            var (ownerId, ownerCreated) = await EnsureOwnerUserAsync(
                connection,
                transaction,
                ownerEmail,
                displayName,
                ownerPassword,
                cancellationToken);

            if (!ownerCreated)
            {
                await SetUserPasswordAsync(connection, transaction, ownerId, ownerPassword, cancellationToken);
            }

            Guid salonId;
            try
            {
                salonId = await connection.ExecuteScalarAsync<Guid>(
                    new CommandDefinition(
                        """
                        insert into public.salons (name, slug, timezone, phone, address, logo_url)
                        values (@Name, @Slug, @Timezone, @Phone, @Address, @LogoUrl)
                        returning id
                        """,
                        new
                        {
                            Name = name,
                            Slug = slug,
                            Timezone = string.IsNullOrWhiteSpace(request.Timezone)
                                ? "America/Argentina/Buenos_Aires"
                                : request.Timezone.Trim(),
                            Phone = NullIfEmpty(request.Phone),
                            Address = NullIfEmpty(request.Address),
                            LogoUrl = NullIfEmpty(request.LogoUrl)
                        },
                        transaction,
                        cancellationToken: cancellationToken));
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return Results.Conflict(new { message = "Ese slug ya está en uso. Elegí otra URL pública." });
            }

            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    insert into public.salon_members (salon_id, user_id, role)
                    values (@SalonId, @OwnerId, 'owner')
                    on conflict (salon_id, user_id) do update set role = 'owner'
                    """,
                    new { SalonId = salonId, OwnerId = ownerId },
                    transaction,
                    cancellationToken: cancellationToken));

            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    insert into public.business_hours (salon_id, weekday, opens_at, closes_at)
                    values
                      (@SalonId, 1, '09:00', '19:00'),
                      (@SalonId, 2, '09:00', '19:00'),
                      (@SalonId, 3, '09:00', '19:00'),
                      (@SalonId, 4, '09:00', '19:00'),
                      (@SalonId, 5, '09:00', '19:00'),
                      (@SalonId, 6, '09:00', '14:00')
                    on conflict (salon_id, weekday) do nothing
                    """,
                    new { SalonId = salonId },
                    transaction,
                    cancellationToken: cancellationToken));

            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    insert into public.salon_modules (salon_id, module_key, enabled, enabled_at, enabled_by)
                    select @SalonId, pm.key, pm.key = 'hair', case when pm.key = 'hair' then now() end, @AdminId
                    from public.platform_modules pm
                    where pm.active
                    on conflict (salon_id, module_key) do nothing
                    """,
                    new { SalonId = salonId, AdminId = adminId == Guid.Empty ? (Guid?)null : adminId },
                    transaction,
                    cancellationToken: cancellationToken));

            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    insert into public.staff (salon_id, user_id, display_name)
                    values (@SalonId, @OwnerId, @DisplayName)
                    on conflict (salon_id, user_id) do update set display_name = excluded.display_name
                    """,
                    new { SalonId = salonId, OwnerId = ownerId, DisplayName = displayName },
                    transaction,
                    cancellationToken: cancellationToken));

            var enabledModules = (await connection.QueryAsync<string>(
                new CommandDefinition(
                    """
                    select module_key
                    from public.salon_modules
                    where salon_id = @SalonId and enabled and module_key <> 'products'
                    """,
                    new { SalonId = salonId },
                    transaction,
                    cancellationToken: cancellationToken))).AsList();

            foreach (var moduleKey in enabledModules)
            {
                await SyncSalonModuleServicesAsync(connection, transaction, salonId, moduleKey, cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
            return Results.Created(
                $"/api/platform/salons/{salonId}",
                new { id = salonId, slug, ownerCreated });
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static async Task<IResult> UpdateSalon(
        Guid id,
        UpdateSalonRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!await EnsurePlatformAdmin(user, db, cancellationToken))
        {
            return Results.Forbid();
        }

        if (request.Active is null && request.LogoUrl is null)
        {
            return Results.BadRequest(new { message = "No hay cambios para guardar." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        var updated = await connection.ExecuteAsync(
            new CommandDefinition(
                """
                update public.salons
                set active = coalesce(@Active, active),
                    logo_url = case when @LogoUrlSet then @LogoUrl else logo_url end
                where id = @Id
                """,
                new
                {
                    Id = id,
                    request.Active,
                    LogoUrl = NullIfEmpty(request.LogoUrl),
                    LogoUrlSet = request.LogoUrl is not null
                },
                cancellationToken: cancellationToken));

        return updated == 0
            ? Results.NotFound(new { message = "Cliente no encontrado." })
            : Results.Ok(new { id, active = request.Active, logoUrl = request.LogoUrl });
    }

    private static async Task<IResult> ResetOwnerPassword(
        Guid id,
        ResetOwnerPasswordRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!await EnsurePlatformAdmin(user, db, cancellationToken))
        {
            return Results.Forbid();
        }

        var password = request.Password ?? "";
        if (password.Length < 6)
        {
            return Results.BadRequest(new { message = "La contraseña debe tener al menos 6 caracteres." });
        }

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            var ownerId = await connection.ExecuteScalarAsync<Guid?>(
                new CommandDefinition(
                    """
                    select sm.user_id
                    from public.salon_members sm
                    where sm.salon_id = @SalonId and sm.role = 'owner'
                    limit 1
                    """,
                    new { SalonId = id },
                    transaction,
                    cancellationToken: cancellationToken));

            if (ownerId is null)
            {
                return Results.NotFound(new { message = "No se encontró el titular de este cliente." });
            }

            await SetUserPasswordAsync(connection, transaction, ownerId.Value, password, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Results.Ok(new { id, updated = true });
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    private static async Task<IResult> SetSalonModule(
        Guid id,
        string moduleKey,
        SetSalonModuleRequest request,
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        if (!await EnsurePlatformAdmin(user, db, cancellationToken))
        {
            return Results.Forbid();
        }

        Guid.TryParse(user.FindFirstValue("sub"), out var adminId);

        await using var connection = (NpgsqlConnection)db.Create();
        await connection.OpenAsync(cancellationToken);

        var moduleExists = await connection.ExecuteScalarAsync<bool>(
            new CommandDefinition(
                "select exists (select 1 from public.platform_modules where key = @Key and active)",
                new { Key = moduleKey },
                cancellationToken: cancellationToken));

        if (!moduleExists)
        {
            return Results.BadRequest(new { message = "Módulo inválido." });
        }

        var salonExists = await connection.ExecuteScalarAsync<bool>(
            new CommandDefinition(
                "select exists (select 1 from public.salons where id = @Id)",
                new { Id = id },
                cancellationToken: cancellationToken));

        if (!salonExists)
        {
            return Results.NotFound(new { message = "Cliente no encontrado." });
        }

        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                insert into public.salon_modules (salon_id, module_key, enabled, enabled_at, enabled_by, updated_at)
                values (
                  @SalonId,
                  @ModuleKey,
                  @Enabled,
                  case when @Enabled then now() else null end,
                  case when @Enabled then @AdminId else null end,
                  now()
                )
                on conflict (salon_id, module_key) do update
                set enabled = excluded.enabled,
                    enabled_at = case when excluded.enabled then now() else public.salon_modules.enabled_at end,
                    enabled_by = case when excluded.enabled then excluded.enabled_by else public.salon_modules.enabled_by end,
                    updated_at = now()
                """,
                new
                {
                    SalonId = id,
                    ModuleKey = moduleKey,
                    request.Enabled,
                    AdminId = adminId == Guid.Empty ? (Guid?)null : adminId
                },
                cancellationToken: cancellationToken));

        if (moduleKey != "products")
        {
            await SyncSalonModuleServicesAsync(connection, null, id, moduleKey, cancellationToken);
        }

        return Results.Ok(new { salonId = id, moduleKey, request.Enabled });
    }

    public static async Task<bool> IsPlatformAdmin(
        Guid userId,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        await using var connection = (NpgsqlConnection)db.Create();
        return await connection.ExecuteScalarAsync<bool>(
            new CommandDefinition(
                "select exists (select 1 from public.platform_admins where user_id = @UserId)",
                new { UserId = userId },
                cancellationToken: cancellationToken));
    }

    private static async Task<bool> EnsurePlatformAdmin(
        ClaimsPrincipal user,
        IDbConnectionFactory db,
        CancellationToken cancellationToken)
    {
        var id = user.FindFirstValue("sub");
        return Guid.TryParse(id, out var userId)
            && await IsPlatformAdmin(userId, db, cancellationToken);
    }

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static async Task<(Guid UserId, bool Created)> EnsureOwnerUserAsync(
        NpgsqlConnection connection,
        IDbTransaction transaction,
        string email,
        string displayName,
        string password,
        CancellationToken cancellationToken)
    {
        var ownerId = await connection.ExecuteScalarAsync<Guid?>(
            new CommandDefinition(
                "select id from auth.users where lower(email) = @Email limit 1",
                new { Email = email },
                transaction,
                cancellationToken: cancellationToken));

        if (ownerId is not null)
        {
            return (ownerId.Value, false);
        }

        var userId = Guid.NewGuid();

        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                insert into auth.users (
                  instance_id, id, aud, role, email, encrypted_password,
                  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                  created_at, updated_at,
                  confirmation_token, email_change, email_change_token_new, recovery_token
                ) values (
                  '00000000-0000-0000-0000-000000000000',
                  @Id, 'authenticated', 'authenticated', @Email,
                  extensions.crypt(@Password, extensions.gen_salt('bf')),
                  now(),
                  '{"provider":"email","providers":["email"]}'::jsonb,
                  jsonb_build_object('display_name', @DisplayName),
                  now(), now(), '', '', '', ''
                )
                """,
                new { Id = userId, Email = email, Password = password, DisplayName = displayName },
                transaction,
                cancellationToken: cancellationToken));

        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                insert into auth.identities (
                  id, user_id, identity_data, provider, provider_id,
                  last_sign_in_at, created_at, updated_at
                ) values (
                  gen_random_uuid(), @UserId,
                  jsonb_build_object('sub', @UserIdText, 'email', @Email),
                  'email', @UserIdText,
                  now(), now(), now()
                )
                """,
                new { UserId = userId, UserIdText = userId.ToString(), Email = email },
                transaction,
                cancellationToken: cancellationToken));

        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                insert into public.profiles (id, email, display_name)
                values (@Id, @Email, @DisplayName)
                on conflict (id) do update
                  set email = excluded.email,
                      display_name = excluded.display_name
                """,
                new { Id = userId, Email = email, DisplayName = displayName },
                transaction,
                cancellationToken: cancellationToken));

        return (userId, true);
    }

    private static Task SyncSalonModuleServicesAsync(
        NpgsqlConnection connection,
        IDbTransaction? transaction,
        Guid salonId,
        string moduleKey,
        CancellationToken cancellationToken) =>
        connection.ExecuteAsync(
            new CommandDefinition(
                "select public.sync_salon_module_services(@SalonId, @ModuleKey)",
                new { SalonId = salonId, ModuleKey = moduleKey },
                transaction,
                cancellationToken: cancellationToken));

    private static Task SetUserPasswordAsync(
        NpgsqlConnection connection,
        IDbTransaction transaction,
        Guid userId,
        string password,
        CancellationToken cancellationToken) =>
        connection.ExecuteAsync(
            new CommandDefinition(
                """
                update auth.users
                set encrypted_password = extensions.crypt(@Password, extensions.gen_salt('bf')),
                    updated_at = now()
                where id = @UserId
                """,
                new { UserId = userId, Password = password },
                transaction,
                cancellationToken: cancellationToken));

    private sealed record PlatformSummary(
        int TotalSalons,
        int ActiveSalons,
        int TotalCustomers,
        int AppointmentsThisMonth,
        int EnabledModules);

    private sealed record PlatformModuleUsage(string Key, string Name, int SalonCount);

    private sealed record PlatformModule(string Key, string Name, string Description, int SortOrder);

    private sealed record PlatformSalonRow(
        Guid Id,
        string Name,
        string Slug,
        string? Phone,
        string? Address,
        bool Active,
        string? LogoUrl,
        DateTime CreatedAt,
        string? OwnerName,
        string? OwnerEmail,
        int CustomerCount,
        int UpcomingCount);

    private sealed record SalonModuleRow(Guid SalonId, string ModuleKey, bool Enabled);

    private sealed record SalonModuleState(string Key, bool Enabled);
}

public sealed record CreateSalonRequest(
    string Name,
    string Slug,
    string OwnerEmail,
    string OwnerPassword,
    string? OwnerName,
    string? LogoUrl,
    string? Timezone,
    string? Phone,
    string? Address);

public sealed record UpdateSalonRequest(bool? Active, string? LogoUrl);

public sealed record ResetOwnerPasswordRequest(string Password);

public sealed record SetSalonModuleRequest(bool Enabled);
