import seedData from "../../fixtures/products.json" with { type: "json" };
import type { Product, ProductsRepository } from "./types.js";

const seed = seedData as Product[];

const products = new Map(seed.map((product) => [product.id, product]));

export class MockProductsRepository implements ProductsRepository {
  async list(): Promise<Product[]> {
    return Array.from(products.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async create(product: Product): Promise<Product> {
    products.set(product.id, product);
    return product;
  }

  async findById(productId: string): Promise<Product | null> {
    return products.get(productId) ?? null;
  }

  async update(product: Product): Promise<Product> {
    products.set(product.id, product);
    return product;
  }

  async remove(productId: string): Promise<void> {
    products.delete(productId);
  }
}
