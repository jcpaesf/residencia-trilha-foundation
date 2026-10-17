BEGIN;

CREATE TABLE IF NOT EXISTS products (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  stock       integer NOT NULL CHECK (stock >= 0),
  seller_id   text NOT NULL,
  image_keys  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_seller_created_idx
  ON products (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id              text PRIMARY KEY,
  buyer_id        text NOT NULL,
  seller_id       text NOT NULL,
  product_id      text NOT NULL REFERENCES products(id),
  quantity        integer NOT NULL CHECK (quantity > 0),
  status          text NOT NULL CHECK (status IN ('pending', 'processed')),
  idempotency_key text NOT NULL UNIQUE,
  buyer_name      text,
  buyer_email     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_buyer_created_idx
  ON orders (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_seller_created_idx
  ON orders (seller_id, created_at DESC);

COMMIT;
