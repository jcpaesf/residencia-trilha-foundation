using Residencia.Foundation.Orders;
using Residencia.Foundation.Orders.Data;

var repository = new RdsCommerceRepository();
var product = await repository.FindProduct("smoke-product")
    ?? throw new InvalidOperationException("Seed product was not found by the order Lambda adapter.");
if (product.Stock != 5)
    throw new InvalidOperationException($"Expected stock 5, received {product.Stock}.");

var order = new SellerOrder(
    "smoke-order",
    "smoke-buyer",
    "smoke-seller",
    "smoke-product",
    2,
    "pending",
    DateTimeOffset.Parse("2026-01-01T01:00:00Z"),
    "Smoke Buyer",
    "smoke@example.com"
);
await repository.CreatePendingOrder(order, "smoke-order");

var buyerOrders = await repository.ListBuyerOrders("smoke-buyer");
var sellerOrders = await repository.ListSellerOrders("smoke-seller");
if (buyerOrders.Count != 1 || sellerOrders.Count != 1 || buyerOrders[0].Status != "pending")
    throw new InvalidOperationException("Order RDS adapter did not return the pending order.");

Console.WriteLine("order-api-rds-ok");
