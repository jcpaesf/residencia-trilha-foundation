export type Product = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
  sellerId: string;
  imageKeys: string[];
  imageKey?: string | null;
  createdAt: string;
};

export type ProductInput = Product;

export interface ProductsRepository {
  list(): Promise<Product[]>;
  findById(productId: string): Promise<Product | null>;
  create(product: ProductInput): Promise<Product>;
  update(product: ProductInput): Promise<Product>;
  remove(productId: string): Promise<void>;
}
