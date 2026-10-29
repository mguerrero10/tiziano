using System.Data;
using Npgsql;

namespace StudentHub.Api.Data;

public interface IDbConnectionFactory
{
    bool IsConfigured { get; }
    IDbConnection Create();
}

public sealed class DbConnectionFactory(IConfiguration configuration) : IDbConnectionFactory
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["SUPABASE_DB_PASSWORD"])
        || HasPassword(configuration.GetConnectionString("Supabase"));

    public IDbConnection Create()
    {
        var connectionString = ResolveConnectionString()
            ?? throw new InvalidOperationException(
                "Falta SUPABASE_DB_PASSWORD");

        return new NpgsqlConnection(connectionString);
    }

    private string? ResolveConnectionString()
    {
        var configured = configuration.GetConnectionString("Supabase");
        if (HasPassword(configured))
        {
            return configured;
        }

        var password = configuration["SUPABASE_DB_PASSWORD"];
        if (string.IsNullOrWhiteSpace(password))
        {
            return null;
        }

        var host = configuration["SUPABASE_DB_HOST"]
            ?? configuration["Supabase:DbHost"]
            ?? "aws-1-us-west-2.pooler.supabase.com";
        var port = configuration["SUPABASE_DB_PORT"] ?? "5432";
        var username = configuration["SUPABASE_DB_USER"] ?? "postgres.ldowtjjzzkybodbkyicc";
        return $"Host={host};Port={port};Database=postgres;Username={username};Password={password};SSL Mode=Require;Trust Server Certificate=true";
    }

    private static bool HasPassword(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return false;
        }

        return connectionString.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(part =>
                part.StartsWith("Password=", StringComparison.OrdinalIgnoreCase)
                && part.Length > "Password=".Length);
    }
}
