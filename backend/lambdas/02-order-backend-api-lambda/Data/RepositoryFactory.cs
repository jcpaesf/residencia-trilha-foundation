namespace Residencia.Foundation.Orders.Data;

public static class RepositoryFactory
{
    public static ICommerceRepository Create() =>
        (Environment.GetEnvironmentVariable("DATA_SOURCE") ?? "mock").ToLowerInvariant() switch
        {
            "dynamodb" => new DynamoCommerceRepository(),
            "mock" => new MockCommerceRepository(),
            "rds" => new RdsCommerceRepository(),
            var value => throw new InvalidOperationException($"Unsupported DATA_SOURCE: {value}"),
        };
}
