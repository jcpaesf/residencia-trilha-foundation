import { RdsOrderProcessor } from "../lambdas/03-order-processor-lambda/src/processors/rds-order-processor.js";

const processor = new RdsOrderProcessor();
const order = {
  orderId: "smoke-order",
  buyerId: "smoke-buyer",
  buyerName: "Smoke Buyer",
  buyerEmail: "smoke@example.com",
  sellerId: "smoke-seller",
  productId: "smoke-product",
  quantity: 2,
  occurredAt: "2026-01-01T01:00:00.000Z",
  idempotencyKey: "smoke-order",
};

const first = await processor.process(order);
const duplicate = await processor.process(order);
if (first.status !== "processed" || first.stock !== 3 || duplicate.status !== "duplicate") {
  throw new Error(`Unexpected processing results: ${JSON.stringify({ first, duplicate })}`);
}

console.log("order-processor-rds-ok");
process.exit(0);
