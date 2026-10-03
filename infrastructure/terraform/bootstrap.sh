#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Uso:
  ./infrastructure/terraform/bootstrap.sh <plan|apply|destroy> <stack> [argumentos do terraform]

Variaveis de ambiente:
  RESIDENCIA_STATE_BUCKET  Bucket S3 do remote state
  RESIDENCIA_REGION        Regiao AWS (padrao: us-east-1)

Exemplo:
  RESIDENCIA_STATE_BUCKET=meu-state-bucket \
    ./infrastructure/terraform/bootstrap.sh apply 01-web-edge
EOF
}

fail() {
  echo "Erro: $1" >&2
  exit 1
}

[[ $# -ge 2 ]] || { usage; exit 1; }

action="$1"
stack_name="$2"
shift 2

case "$action" in
  plan | apply | destroy) ;;
  *) usage; fail "acao invalida: $action" ;;
esac

[[ "$stack_name" =~ ^[0-9][0-9]-[a-z0-9-]+$ ]] || \
  fail "nome de stack invalido: $stack_name"

command -v terraform >/dev/null 2>&1 || fail "Terraform nao encontrado"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stack_dir="${script_dir}/stacks/${stack_name}"
aws_region="${RESIDENCIA_REGION:-us-east-1}"
state_bucket="${RESIDENCIA_STATE_BUCKET:-}"

[[ -d "$stack_dir" ]] || fail "stack nao encontrada: $stack_name"
[[ -n "$(find "$stack_dir" -maxdepth 1 -type f -name '*.tf' -print -quit)" ]] || \
  fail "a stack ainda nao possui arquivos Terraform: $stack_name"
[[ -n "$state_bucket" ]] || \
  fail "defina RESIDENCIA_STATE_BUCKET com o bucket do remote state"

terraform -chdir="$stack_dir" init \
  -reconfigure \
  -input=false \
  -backend-config="bucket=${state_bucket}" \
  -backend-config="key=residencia-foundation/${stack_name}.tfstate" \
  -backend-config="region=${aws_region}" \
  -backend-config="use_lockfile=true"

terraform -chdir="$stack_dir" "$action" \
  -input=false \
  -var="aws_region=${aws_region}" \
  "$@"
