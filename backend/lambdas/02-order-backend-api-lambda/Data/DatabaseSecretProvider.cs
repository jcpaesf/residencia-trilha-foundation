using System.Text.Json;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;

namespace Residencia.Foundation.Orders.Data;

internal sealed record DatabaseSecret(string Username, string Password);

internal static class DatabaseSecretProvider
{
    private static readonly Lazy<Task<DatabaseSecret>> Cached = new(Load);

    public static Task<DatabaseSecret> Get() => Cached.Value;

    private static async Task<DatabaseSecret> Load()
    {
        var localSecret = Environment.GetEnvironmentVariable("DB_SECRET_JSON");
        if (
            Environment.GetEnvironmentVariable("ALLOW_LOCAL_DB_SECRET") == "true"
            && !string.IsNullOrWhiteSpace(localSecret)
        )
        {
            return Parse(localSecret, "DB_SECRET_JSON");
        }

        var secretArn = Environment.GetEnvironmentVariable("DB_SECRET_ARN")
            ?? throw new InvalidOperationException("DB_SECRET_ARN is required when DATA_SOURCE=rds.");
        using var client = new AmazonSecretsManagerClient();
        var response = await client.GetSecretValueAsync(new GetSecretValueRequest
        {
            SecretId = secretArn,
        });
        if (string.IsNullOrWhiteSpace(response.SecretString))
            throw new InvalidOperationException("Database secret does not contain SecretString.");

        return Parse(response.SecretString, "Database secret");
    }

    private static DatabaseSecret Parse(string json, string source)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var username = root.TryGetProperty("username", out var usernameValue)
            ? usernameValue.GetString()
            : null;
        var password = root.TryGetProperty("password", out var passwordValue)
            ? passwordValue.GetString()
            : null;
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException($"{source} must contain username and password.");

        return new DatabaseSecret(username, password);
    }
}
