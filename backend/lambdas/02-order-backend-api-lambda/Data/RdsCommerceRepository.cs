using Npgsql;

namespace Residencia.Foundation.Orders.Data;

public sealed class RdsCommerceRepository : ICommerceRepository
{
    private readonly string _connectionString = BuildConnectionString();

    public async Task<ProductReference?> FindProduct(string productId)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT id, seller_id, stock FROM products WHERE id = @id",
            connection
        );
        command.Parameters.AddWithValue("id", productId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;

        return new ProductReference(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetInt32(2)
        );
    }

    public async Task CreatePendingOrder(SellerOrder order, string idempotencyKey)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO orders (
                id, buyer_id, seller_id, product_id, quantity, status,
                idempotency_key, created_at
            )
            VALUES (@id, @buyerId, @sellerId, @productId, @quantity, 'pending', @idempotencyKey, @createdAt)
            """,
            connection
        );
        command.Parameters.AddWithValue("id", order.Id);
        command.Parameters.AddWithValue("buyerId", order.BuyerId);
        command.Parameters.AddWithValue("sellerId", order.SellerId);
        command.Parameters.AddWithValue("productId", order.ProductId);
        command.Parameters.AddWithValue("quantity", order.Quantity);
        command.Parameters.AddWithValue("idempotencyKey", idempotencyKey);
        command.Parameters.AddWithValue("createdAt", order.CreatedAt);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<IReadOnlyList<SellerOrder>> ListSellerOrders(string sellerId)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            SELECT id, buyer_id, seller_id, product_id, quantity, status, created_at
            FROM orders
            WHERE seller_id = @sellerId
            ORDER BY created_at DESC
            """,
            connection
        );
        command.Parameters.AddWithValue("sellerId", sellerId);
        await using var reader = await command.ExecuteReaderAsync();
        var orders = new List<SellerOrder>();

        while (await reader.ReadAsync())
        {
            orders.Add(new SellerOrder(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetInt32(4),
                reader.GetString(5),
                reader.GetFieldValue<DateTimeOffset>(6)
            ));
        }

        return orders;
    }

    public async Task<IReadOnlyList<SellerOrder>> ListBuyerOrders(string buyerId)
    {
        await using var connection = new NpgsqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            SELECT id, buyer_id, seller_id, product_id, quantity, status, created_at
            FROM orders
            WHERE buyer_id = @buyerId
            ORDER BY created_at DESC
            """,
            connection
        );
        command.Parameters.AddWithValue("buyerId", buyerId);
        await using var reader = await command.ExecuteReaderAsync();
        var orders = new List<SellerOrder>();
        while (await reader.ReadAsync())
        {
            orders.Add(new SellerOrder(
                reader.GetString(0), reader.GetString(1), reader.GetString(2),
                reader.GetString(3), reader.GetInt32(4), reader.GetString(5),
                reader.GetFieldValue<DateTimeOffset>(6)
            ));
        }
        return orders;
    }

    private static string BuildConnectionString()
    {
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = Required("DB_HOST"),
            Port = int.Parse(Environment.GetEnvironmentVariable("DB_PORT") ?? "5432"),
            Database = Required("DB_NAME"),
            Username = Required("DB_USER"),
            Password = Required("DB_PASSWORD"),
            SslMode = Environment.GetEnvironmentVariable("DB_SSL") == "true"
                ? SslMode.Require
                : SslMode.Disable,
        };
        return builder.ConnectionString;
    }

    private static string Required(string name) =>
        Environment.GetEnvironmentVariable(name)
        ?? throw new InvalidOperationException($"{name} is required when DATA_SOURCE=rds.");
}
