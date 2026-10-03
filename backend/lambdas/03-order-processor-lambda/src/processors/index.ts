import { MockOrderProcessor } from "./mock-order-processor.js";
import type { OrderProcessor } from "./types.js";

let processor: OrderProcessor | undefined;

export const getOrderProcessor = async (): Promise<OrderProcessor> => {
  if (processor) return processor;

  const dataSource = (process.env.DATA_SOURCE ?? "mock").toLowerCase();
  if (dataSource === "dynamodb") {
    const { DynamoDbOrderProcessor } = await import("./dynamodb-order-processor.js");
    processor = new DynamoDbOrderProcessor();
    return processor;
  }

  if (dataSource === "mock") {
    processor = new MockOrderProcessor();
    return processor;
  }

  if (dataSource === "rds") {
    const { RdsOrderProcessor } = await import("./rds-order-processor.js");
    processor = new RdsOrderProcessor();
    return processor;
  }

  throw new Error(`Unsupported DATA_SOURCE: ${dataSource}`);
};
