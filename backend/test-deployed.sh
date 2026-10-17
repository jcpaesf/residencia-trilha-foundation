#!/usr/bin/env bash

set -euo pipefail

stack_name="${CATCH_UP_BACKEND_STACK:-residencia-foundation-catch-up-marketplace-backend}"
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
repository_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_email="codex.e2e.$(date +%s)@example.com"
test_password="Foundation$(date +%s)Aa!"
token=""
product_id=""
order_id=""
upload_url=""

aws_args=(--region "$region")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  aws_args+=(--profile "$AWS_PROFILE")
fi

stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text \
    "${aws_args[@]}"
}

user_pool_id="$(stack_output UserPoolId)"
client_id="$(stack_output UserPoolClientId)"
api_url="$(stack_output ApiUrl)"
table_name="$(stack_output MarketplaceTableName)"

cleanup() {
  if [[ -n "$token" && -n "$product_id" ]]; then
    curl -sS -X DELETE "$api_url/products/$product_id" \
      -H "Authorization: Bearer $token" >/dev/null || true
  fi
  if [[ -n "$order_id" ]]; then
    aws dynamodb delete-item \
      --table-name "$table_name" \
      --key "{\"pk\":{\"S\":\"ORDER#$order_id\"}}" \
      "${aws_args[@]}" >/dev/null 2>&1 || true
  fi
  aws cognito-idp admin-delete-user \
    --user-pool-id "$user_pool_id" \
    --username "$test_email" \
    "${aws_args[@]}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

aws cognito-idp admin-create-user \
  --user-pool-id "$user_pool_id" \
  --username "$test_email" \
  --message-action SUPPRESS \
  --user-attributes \
    "Name=email,Value=$test_email" \
    "Name=email_verified,Value=true" \
    "Name=name,Value=Teste E2E" \
  "${aws_args[@]}" >/dev/null

aws cognito-idp admin-set-user-password \
  --user-pool-id "$user_pool_id" \
  --username "$test_email" \
  --password "$test_password" \
  --permanent \
  "${aws_args[@]}"

token="$(
  cd "$repository_dir/site"
  USER_POOL_ID="$user_pool_id" \
  CLIENT_ID="$client_id" \
  TEST_EMAIL="$test_email" \
  TEST_PASSWORD="$test_password" \
  node -e '
    const { CognitoUserPool, CognitoUser, AuthenticationDetails } = require("amazon-cognito-identity-js");
    const pool = new CognitoUserPool({
      UserPoolId: process.env.USER_POOL_ID,
      ClientId: process.env.CLIENT_ID,
    });
    const user = new CognitoUser({ Username: process.env.TEST_EMAIL, Pool: pool });
    const details = new AuthenticationDetails({
      Username: process.env.TEST_EMAIL,
      Password: process.env.TEST_PASSWORD,
    });
    user.authenticateUser(details, {
      onSuccess: (session) => process.stdout.write(session.getIdToken().getJwtToken()),
      onFailure: (error) => { console.error(error); process.exit(1); },
    });
  '
)"

create_product="$(curl --fail-with-body -sS -X POST "$api_url/products" \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  --data '{"name":"Produto E2E","description":"Teste automatizado","priceCents":1590,"stock":5,"images":[{"fileName":"teste-e2e.txt","contentType":"text/plain"}]}')"

product_id="$(PAYLOAD="$create_product" node -e '
  const payload = JSON.parse(process.env.PAYLOAD);
  if (!payload.product?.id) throw new Error("A API não devolveu o produto criado.");
  process.stdout.write(payload.product.id);
')"

upload_url="$(PAYLOAD="$create_product" node -e '
  const payload = JSON.parse(process.env.PAYLOAD);
  if (!payload.imageUploads?.[0]?.uploadUrl) {
    throw new Error("A API não devolveu a URL de upload da imagem.");
  }
  process.stdout.write(payload.imageUploads[0].uploadUrl);
')"

curl --fail-with-body -sS -X PUT "$upload_url" \
  -H "Content-Type: text/plain" \
  --data-binary "imagem-e2e" >/dev/null

create_order="$(curl --fail-with-body -sS -X POST "$api_url/orders" \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  --data "{\"productId\":\"$product_id\",\"quantity\":2}")"

order_id="$(PAYLOAD="$create_order" node -e '
  const payload = JSON.parse(process.env.PAYLOAD);
  if (!payload.orderId || payload.status !== "pending") {
    throw new Error("A API não devolveu um pedido pendente.");
  }
  process.stdout.write(payload.orderId);
')"

processed="false"
for _attempt in {1..10}; do
  buyer_orders="$(curl --fail-with-body -sS "$api_url/orders" \
    -H "Authorization: Bearer $token")"
  status="$(PAYLOAD="$buyer_orders" ORDER_ID="$order_id" node -e '
    const payload = JSON.parse(process.env.PAYLOAD);
    const order = payload.items?.find((item) => item.id === process.env.ORDER_ID);
    process.stdout.write(order?.status ?? "");
  ')"
  if [[ "$status" == "processed" ]]; then
    processed="true"
    break
  fi
  sleep 2
done

[[ "$processed" == "true" ]] || {
  echo "Erro: o pedido $order_id não foi processado pela fila." >&2
  exit 1
}

seller_orders="$(curl --fail-with-body -sS "$api_url/seller/orders" \
  -H "Authorization: Bearer $token")"
products="$(curl --fail-with-body -sS "$api_url/products" \
  -H "Authorization: Bearer $token")"

SELLER_ORDERS="$seller_orders" \
PRODUCTS="$products" \
ORDER_ID="$order_id" \
PRODUCT_ID="$product_id" \
node -e '
  const sellerOrders = JSON.parse(process.env.SELLER_ORDERS);
  const products = JSON.parse(process.env.PRODUCTS);
  const order = sellerOrders.items?.find((item) => item.id === process.env.ORDER_ID);
  const product = products.items?.find((item) => item.id === process.env.PRODUCT_ID);
  if (order?.status !== "processed") {
    throw new Error("O vendedor não recebeu o pedido processado.");
  }
  if (product?.stock !== 3) {
    throw new Error(`O estoque esperado era 3, mas a API devolveu ${product?.stock}.`);
  }
  if (!product.imageUrls?.[0]) {
    throw new Error("A API não devolveu a URL de leitura da imagem.");
  }
'

image_url="$(PRODUCTS="$products" PRODUCT_ID="$product_id" node -e '
  const products = JSON.parse(process.env.PRODUCTS);
  const product = products.items?.find((item) => item.id === process.env.PRODUCT_ID);
  process.stdout.write(product.imageUrls[0]);
')"
image_body="$(curl --fail-with-body -sS "$image_url")"
[[ "$image_body" == "imagem-e2e" ]] || {
  echo "Erro: o conteúdo recuperado do S3 não corresponde ao upload." >&2
  exit 1
}

echo "e2e-publicado-ok: autenticação, catálogo, imagens, pedido, SQS, processamento e estoque validados."
