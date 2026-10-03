import { Pool, type QueryResultRow } from "pg";
import type { OrderEvent, OrderProcessor, ProcessingResult } from "./types.js";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  max: 2,
});

type StockRow = QueryResultRow & { stock: number };
type OrderRow = QueryResultRow & { id: string; status: string };

export class RdsOrderProcessor implements OrderProcessor {
  async process(order: OrderEvent): Promise<ProcessingResult> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query<OrderRow>(
        "SELECT id, status FROM orders WHERE idempotency_key = $1 FOR UPDATE",
        [order.idempotencyKey],
      );
      if (existing.rows[0]?.status === "processed") {
        await client.query("ROLLBACK");
        return { status: "duplicate", orderId: order.orderId };
      }

      const stock = await client.query<StockRow>(
        `
          UPDATE products
          SET stock = stock - $2, updated_at = NOW()
          WHERE id = $1 AND stock >= $2
          RETURNING stock
        `,
        [order.productId, order.quantity],
      );
      if (stock.rowCount === 0) {
        throw new Error(`Insufficient stock for product ${order.productId}.`);
      }

      if ((existing.rowCount ?? 0) > 0) {
        await client.query(
          "UPDATE orders SET status = 'processed' WHERE idempotency_key = $1 AND status = 'pending'",
          [order.idempotencyKey],
        );
      } else {
        await client.query(
          `
            INSERT INTO orders (
              id, buyer_id, seller_id, product_id, quantity, status,
              idempotency_key, created_at
            )
            VALUES ($1, $2, $3, $4, $5, 'processed', $6, $7)
          `,
          [
            order.orderId,
            order.buyerId,
            order.sellerId,
            order.productId,
            order.quantity,
            order.idempotencyKey,
            order.occurredAt,
          ],
        );
      }

      await client.query("COMMIT");
      return {
        status: "processed",
        orderId: order.orderId,
        stock: stock.rows[0]?.stock,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
