export type OrderEvent = {
  orderId: string;
  buyerId: string;
  buyerName?: string;
  buyerEmail?: string;
  sellerId: string;
  productId: string;
  quantity: number;
  occurredAt: string;
  idempotencyKey: string;
};

export type ProcessingResult = {
  status: "processed" | "duplicate";
  orderId: string;
  productId?: string;
  quantity?: number;
  stock?: number;
};

export interface OrderProcessor {
  process(order: OrderEvent): Promise<ProcessingResult>;
}
