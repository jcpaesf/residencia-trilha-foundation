#!/usr/bin/env bash

set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_dir="$(cd "${backend_dir}/.." && pwd)"
postgres_bin="${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@16/bin}"

for command in initdb pg_ctl createdb psql; do
  [[ -x "${postgres_bin}/${command}" ]] || {
    echo "PostgreSQL 16 não encontrado em ${postgres_bin}." >&2
    exit 1
  }
done

test_root="$(mktemp -d "${TMPDIR:-/tmp}/residencia-rds-smoke.XXXXXX")"
data_dir="${test_root}/data"
socket_dir="${test_root}/socket"
mkdir -p "$socket_dir"

cleanup() {
  "${postgres_bin}/pg_ctl" -D "$data_dir" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$test_root"
}
trap cleanup EXIT

"${postgres_bin}/initdb" -D "$data_dir" --auth=trust --no-locale >/dev/null
"${postgres_bin}/pg_ctl" -D "$data_dir" \
  -o "-h 127.0.0.1 -p 55432 -k ${socket_dir}" \
  -l "${test_root}/postgres.log" start >/dev/null
"${postgres_bin}/createdb" -h 127.0.0.1 -p 55432 marketplace
"${postgres_bin}/psql" -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -d marketplace \
  -f "${backend_dir}/sql/001_marketplace.sql" >/dev/null
"${postgres_bin}/psql" -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -d marketplace \
  -f "${backend_dir}/sql/001_marketplace.sql" >/dev/null

export DATA_SOURCE=rds
export DB_HOST=127.0.0.1
export DB_PORT=55432
export DB_NAME=marketplace
export DB_SSL=false
export ALLOW_LOCAL_DB_SECRET=true
export DB_SECRET_JSON="{\"username\":\"$(id -un)\",\"password\":\"local-smoke-only\"}"

node_bundle="${test_root}/rds-seed.mjs"
"${backend_dir}/lambdas/01-catalog-backend-api-lambda/node_modules/.bin/esbuild" \
  "${backend_dir}/tests/rds-seed.ts" --bundle --platform=node --format=esm \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="$node_bundle" >/dev/null
node "$node_bundle"

dotnet run --project "${backend_dir}/tests/RdsOrderSmoke/RdsOrderSmoke.csproj" --configuration Release

processor_bundle="${test_root}/rds-process.mjs"
"${backend_dir}/lambdas/03-order-processor-lambda/node_modules/.bin/esbuild" \
  "${backend_dir}/tests/rds-process.ts" --bundle --platform=node --format=esm \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="$processor_bundle" >/dev/null
node "$processor_bundle"

result="$("${postgres_bin}/psql" -At -h 127.0.0.1 -p 55432 -d marketplace -c \
  "SELECT o.status || ':' || p.stock FROM orders o JOIN products p ON p.id = o.product_id WHERE o.id = 'smoke-order';")"
[[ "$result" == "processed:3" ]] || {
  echo "Resultado inesperado no PostgreSQL: ${result}" >&2
  exit 1
}

echo "rds-smoke-ok: schema, catálogo, criação do pedido, processamento e idempotência validados."
