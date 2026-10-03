namespace Residencia.Foundation.Orders.Data;

public sealed class MockCommerceRepository : ICommerceRepository
{
    private static readonly IReadOnlyDictionary<string, ProductReference> Products =
        new Dictionary<string, ProductReference>();

    private static readonly List<SellerOrder> Orders = [];

    public Task<ProductReference?> FindProduct(string productId) =>
        Task.FromResult(Products.GetValueOrDefault(productId));

    public Task CreatePendingOrder(SellerOrder order, string idempotencyKey)
    {
        Orders.Add(order);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<SellerOrder>> ListSellerOrders(string sellerId) =>
        Task.FromResult<IReadOnlyList<SellerOrder>>(
            Orders.Where(order => order.SellerId == sellerId).ToArray()
        );

    public Task<IReadOnlyList<SellerOrder>> ListBuyerOrders(string buyerId) =>
        Task.FromResult<IReadOnlyList<SellerOrder>>(
            Orders.Where(order => order.BuyerId == buyerId).ToArray()
        );
}
