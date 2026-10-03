namespace Residencia.Foundation.Orders.Data;

public interface ICommerceRepository
{
    Task<ProductReference?> FindProduct(string productId);
    Task CreatePendingOrder(SellerOrder order, string idempotencyKey);
    Task<IReadOnlyList<SellerOrder>> ListBuyerOrders(string buyerId);
    Task<IReadOnlyList<SellerOrder>> ListSellerOrders(string sellerId);
}
