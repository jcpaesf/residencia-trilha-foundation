import type { AuthenticatedUser } from "./auth";
import { isMockMode } from "./config";

export type Product = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
  sellerId: string;
  imageKeys: string[];
  imageUrls: string[];
  imageKey?: string | null;
  imageUrl?: string | null;
  createdAt: string;
};

export type Order = {
  id: string;
  buyerId: string;
  buyerName?: string | null;
  buyerEmail?: string | null;
  sellerId: string;
  productId: string;
  quantity: number;
  status: string;
  createdAt: string;
};

export type ProductInput = {
  name: string;
  description: string;
  priceCents: number;
  stock: number;
};

type MockState = { products: Product[]; orders: Order[] };
const apiUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const mockStateKey = "foundation-market:mock-state";
const initialMockState: MockState = {
  products: [],
  orders: [],
};

const readMockState = (): MockState => {
  const raw = window.localStorage.getItem(mockStateKey);
  if (!raw) return structuredClone(initialMockState);

  const state = JSON.parse(raw) as MockState;
  const demoProductIds = new Set(["product-001", "product-002"]);
  const cleaned: MockState = {
    products: state.products.filter((product) => !demoProductIds.has(product.id)),
    orders: state.orders.filter((order) => !demoProductIds.has(order.productId)),
  };

  if (cleaned.products.length !== state.products.length || cleaned.orders.length !== state.orders.length) {
    writeMockState(cleaned);
  }

  return cleaned;
};

const writeMockState = (state: MockState) =>
  window.localStorage.setItem(mockStateKey, JSON.stringify(state));

const normalizeProduct = (product: Product): Product => ({
  ...product,
  imageKeys: product.imageKeys ?? (product.imageKey ? [product.imageKey] : []),
  imageUrls: product.imageUrls ?? (product.imageUrl ? [product.imageUrl] : []),
});

const request = async <T>(user: AuthenticatedUser, path: string, options?: RequestInit): Promise<T> => {
  if (!apiUrl) throw new Error("Configure VITE_API_URL para conectar o marketplace ao API Gateway.");
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${user.idToken || user.accessToken}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `A API respondeu com status ${response.status}.`);
  }
  return response.json() as Promise<T>;
};

const fileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error("Não foi possível ler a imagem."));
  reader.readAsDataURL(file);
});

export const listProducts = async (user: AuthenticatedUser): Promise<Product[]> => {
  if (isMockMode) return readMockState().products.map(normalizeProduct);
  return (await request<{ items: Product[] }>(user, "/products")).items.map(normalizeProduct);
};

type ImageUpload = { uploadUrl: string; key: string };

const uploadImages = async (files: File[], targets: ImageUpload[]) => {
  await Promise.all(files.map(async (file, index) => {
    const target = targets[index];
    if (!target) throw new Error("A API não devolveu uma URL para cada imagem.");
    const upload = await fetch(target.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!upload.ok) throw new Error(`Não foi possível enviar a imagem ${file.name}.`);
  }));
};

export const createProduct = async (
  user: AuthenticatedUser,
  input: ProductInput,
  images: File[] = [],
): Promise<Product> => {
  if (isMockMode) {
    const state = readMockState();
    const product: Product = {
      id: crypto.randomUUID(), ...input, sellerId: user.sub,
      imageKeys: images.map((image) => image.name),
      imageUrls: await Promise.all(images.map(fileAsDataUrl)),
      createdAt: new Date().toISOString(),
    };
    state.products.unshift(product);
    writeMockState(state);
    return product;
  }
  const response = await request<{
    product: Product;
    imageUploads: ImageUpload[];
  }>(user, "/products", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      images: images.map((image) => ({ fileName: image.name, contentType: image.type })),
    }),
  });
  if (images.length > 0) await uploadImages(images, response.imageUploads);
  return normalizeProduct(response.product);
};

export const updateProduct = async (
  user: AuthenticatedUser,
  productId: string,
  input: ProductInput,
  images: File[] = [],
): Promise<Product> => {
  if (isMockMode) {
    const state = readMockState();
    const product = state.products.find((item) => item.id === productId);
    if (!product || product.sellerId !== user.sub) throw new Error("Produto não encontrado.");
    Object.assign(product, input);
    const normalized = normalizeProduct(product);
    if (images.length > 0) {
      normalized.imageKeys.push(...images.map((image) => image.name));
      normalized.imageUrls.push(...await Promise.all(images.map(fileAsDataUrl)));
    }
    state.products = state.products.map((item) => item.id === productId ? normalized : item);
    writeMockState(state);
    return normalized;
  }
  const response = await request<{
    product: Product;
    imageUploads: ImageUpload[];
  }>(user, `/products/${encodeURIComponent(productId)}`, {
    method: "PUT",
    body: JSON.stringify({
      ...input,
      images: images.map((image) => ({ fileName: image.name, contentType: image.type })),
    }),
  });
  if (images.length > 0) await uploadImages(images, response.imageUploads);
  return normalizeProduct(response.product);
};

export const deleteProduct = async (user: AuthenticatedUser, productId: string): Promise<void> => {
  if (isMockMode) {
    const state = readMockState();
    const product = state.products.find((item) => item.id === productId);
    if (!product || product.sellerId !== user.sub) throw new Error("Produto não encontrado.");
    state.products = state.products.filter((item) => item.id !== productId);
    writeMockState(state);
    return;
  }
  await request<{ removed: boolean }>(user, `/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
  });
};

export const createOrder = async (
  user: AuthenticatedUser,
  productId: string,
  quantity: number,
): Promise<{ orderId: string; status: string; order?: Order }> => {
  if (isMockMode) {
    const state = readMockState();
    const product = state.products.find((item) => item.id === productId);
    if (!product) throw new Error("Produto não encontrado.");
    if (product.stock < quantity) throw new Error("Estoque insuficiente.");
    product.stock -= quantity;
    const order: Order = {
      id: crypto.randomUUID(), buyerId: user.sub, buyerName: user.name, buyerEmail: user.email,
      sellerId: product.sellerId,
      productId, quantity, status: "processed", createdAt: new Date().toISOString(),
    };
    state.orders.unshift(order);
    writeMockState(state);
    return { orderId: order.id, status: order.status, order };
  }
  return request(user, "/orders", {
    method: "POST",
    body: JSON.stringify({ productId, quantity }),
  });
};

export const listBuyerOrders = async (user: AuthenticatedUser): Promise<Order[]> => {
  if (isMockMode) return readMockState().orders.filter((order) => order.buyerId === user.sub);
  return (await request<{ items: Order[] }>(user, "/orders")).items;
};

export const listSellerOrders = async (user: AuthenticatedUser): Promise<Order[]> => {
  if (isMockMode) return readMockState().orders.filter((order) => order.sellerId === user.sub);
  return (await request<{ items: Order[] }>(user, "/seller/orders")).items;
};
