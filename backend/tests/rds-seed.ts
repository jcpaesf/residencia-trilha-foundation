import { RdsProductsRepository } from "../lambdas/01-catalog-backend-api-lambda/src/repositories/rds-products-repository.js";

const repository = new RdsProductsRepository();
const createdAt = "2026-01-01T00:00:00.000Z";

await repository.create({
  id: "smoke-product",
  name: "Produto de teste RDS",
  description: "Valida o adapter real da Lambda de catálogo.",
  priceCents: 19990,
  stock: 5,
  sellerId: "smoke-seller",
  imageKeys: ["products/smoke-product/image.png"],
  createdAt,
});

const product = await repository.findById("smoke-product");
if (!product || product.stock !== 5 || product.priceCents !== 19990) {
  throw new Error("Catalog RDS adapter did not persist the expected product.");
}

console.log("catalog-rds-ok");
process.exit(0);
