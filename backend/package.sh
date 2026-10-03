#!/usr/bin/env bash

set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
catalog_dir="${backend_dir}/lambdas/01-catalog-backend-api-lambda"
orders_dir="${backend_dir}/lambdas/02-order-backend-api-lambda"
processor_dir="${backend_dir}/lambdas/03-order-processor-lambda"

npm --prefix "${catalog_dir}" ci
npm --prefix "${catalog_dir}" run build
rm -f "${catalog_dir}/catalog-backend-api-lambda.zip"
(
  cd "${catalog_dir}/dist"
  zip -qr "../catalog-backend-api-lambda.zip" .
)

orders_publish_dir="${orders_dir}/dist"
rm -rf "${orders_publish_dir}"
dotnet publish "${orders_dir}/OrderBackendApi.csproj" \
  --configuration Release \
  --output "${orders_publish_dir}"
rm -f "${orders_dir}/order-backend-api-lambda.zip"
(
  cd "${orders_publish_dir}"
  zip -qr "../order-backend-api-lambda.zip" .
)

npm --prefix "${processor_dir}" ci
npm --prefix "${processor_dir}" run build
rm -f "${processor_dir}/order-processor-lambda.zip"
(
  cd "${processor_dir}/dist"
  zip -qr "../order-processor-lambda.zip" .
)

printf 'Packages created inside each Lambda directory.\n'
