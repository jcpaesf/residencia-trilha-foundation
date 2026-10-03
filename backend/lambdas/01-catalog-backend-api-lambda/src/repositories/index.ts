import { MockProductsRepository } from "./mock-products-repository.js";
import type { ProductsRepository } from "./types.js";

let repository: ProductsRepository | undefined;

export const getProductsRepository = async (): Promise<ProductsRepository> => {
  if (repository) return repository;

  const dataSource = (process.env.DATA_SOURCE ?? "mock").toLowerCase();
  if (dataSource === "dynamodb") {
    const { DynamoDbProductsRepository } = await import("./dynamodb-products-repository.js");
    repository = new DynamoDbProductsRepository();
    return repository;
  }

  if (dataSource === "mock") {
    repository = new MockProductsRepository();
    return repository;
  }

  if (dataSource === "rds") {
    const { RdsProductsRepository } = await import("./rds-products-repository.js");
    repository = new RdsProductsRepository();
    return repository;
  }

  throw new Error(`Unsupported DATA_SOURCE: ${dataSource}`);
};
