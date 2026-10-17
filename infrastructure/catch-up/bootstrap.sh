#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Uso:
  ./infrastructure/catch-up/bootstrap.sh <apply|status|destroy> <baseline>

Baseline disponivel:
  ready-for-sprint-02  Prepara o resultado funcional da Sprint 1
  ready-for-sprint-03  Prepara o resultado funcional da Sprint 2

Alias temporario:
  sprint-01            Compatibilidade com a primeira versao do script

Variaveis opcionais:
  AWS_PROFILE            Profile configurado na AWS CLI
  AWS_REGION             Regiao das stacks (padrao: us-east-1)
  CATCH_UP_STACK_PREFIX  Prefixo das stacks (padrao: residencia-foundation-catch-up)
  CATCH_UP_ARTIFACTS_BUCKET  Bucket de pacotes das Lambdas (opcional)

Exemplos:
  AWS_PROFILE=aluno ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-02
  AWS_PROFILE=aluno ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-03
  AWS_PROFILE=aluno ./infrastructure/catch-up/bootstrap.sh status ready-for-sprint-02
  AWS_PROFILE=aluno ./infrastructure/catch-up/bootstrap.sh destroy ready-for-sprint-02
EOF
}

fail() {
  echo "Erro: $1" >&2
  exit 1
}

[[ $# -eq 2 ]] || { usage; exit 1; }

action="$1"
baseline="$2"

if [[ "$baseline" == "sprint-01" ]]; then
  echo "Aviso: use ready-for-sprint-02; sprint-01 e um alias temporario."
  baseline="ready-for-sprint-02"
fi

case "$action" in
  apply | status | destroy) ;;
  *) usage; fail "acao invalida: $action" ;;
esac

command -v aws >/dev/null 2>&1 || fail "AWS CLI nao encontrada"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_dir="$(cd "${script_dir}/../.." && pwd)"
baseline_path="${script_dir}/baselines/${baseline}.yaml"
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
stack_prefix="${CATCH_UP_STACK_PREFIX:-residencia-foundation-catch-up}"
artifacts_bucket="${CATCH_UP_ARTIFACTS_BUCKET:-}"

[[ -f "$baseline_path" ]] || fail "baseline nao encontrado: $baseline"

components="$({
  awk '
    /^components:/ { reading = 1; next }
    reading && /^  - / {
      sub(/^  - /, "")
      print
      next
    }
    reading { exit }
  ' "$baseline_path"
})"

[[ -n "$components" ]] || fail "o baseline nao seleciona componentes"

publish_frontend="$({
  awk -F ': ' '$1 == "publish_frontend" { print $2 }' "$baseline_path"
})"

aws_args=(--region "$region")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  aws_args+=(--profile "$AWS_PROFILE")
fi

component_stack_name() {
  local component="$1"
  if [[ "$component" == "web-edge" ]]; then
    # Mantem compatibilidade com a stack criada pela primeira versao do catch-up.
    echo "${stack_prefix}-sprint-01"
  else
    echo "${stack_prefix}-${component}"
  fi
}

stack_output() {
  local stack_name="$1"
  local output_key="$2"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue | [0]" \
    --output text \
    "${aws_args[@]}"
}

seed_stack_events() {
  local stack_name="$1"
  local seen_file="$2"

  aws cloudformation describe-stack-events \
    --stack-name "$stack_name" \
    --query 'StackEvents[].EventId' \
    --output text \
    "${aws_args[@]}" 2>/dev/null |
    tr '\t' '\n' > "$seen_file" || true
}

print_new_stack_events() {
  local stack_name="$1"
  local seen_file="$2"
  local snapshot_file="$3"
  local event_id
  local timestamp
  local event_time
  local resource_status
  local resource_type
  local logical_resource_id
  local status_reason

  events_printed=false
  if ! aws cloudformation describe-stack-events \
    --stack-name "$stack_name" \
    --query 'StackEvents[].[EventId,Timestamp,ResourceStatus,ResourceType,LogicalResourceId,ResourceStatusReason]' \
    --output text \
    "${aws_args[@]}" > "$snapshot_file" 2>/dev/null; then
    return
  fi

  while IFS=$'\t' read -r event_id timestamp resource_status resource_type logical_resource_id status_reason; do
    [[ -n "$event_id" ]] || continue
    grep -Fqx "$event_id" "$seen_file" && continue
    echo "$event_id" >> "$seen_file"

    event_time="${timestamp#*T}"
    event_time="${event_time%%.*}"
    printf '  [%s] %-22s %-30s %s\n' \
      "$event_time" "$resource_status" "$logical_resource_id" "$resource_type"
    if [[ -n "$status_reason" && "$status_reason" != "None" ]]; then
      echo "           $status_reason"
    fi
    events_printed=true
  done < <(awk '{ line[NR] = $0 } END { for (i = NR; i >= 1; i--) print line[i] }' "$snapshot_file")
}

run_with_stack_events() {
  local stack_name="$1"
  shift
  local watch_dir
  local seen_file
  local snapshot_file
  local command_log
  local command_pid
  local command_status
  local last_feedback
  local stack_status

  watch_dir="$(mktemp -d)"
  seen_file="${watch_dir}/seen-events"
  snapshot_file="${watch_dir}/events"
  command_log="${watch_dir}/command.log"
  : > "$seen_file"
  seed_stack_events "$stack_name" "$seen_file"

  "$@" > "$command_log" 2>&1 &
  command_pid=$!
  last_feedback=$SECONDS

  while kill -0 "$command_pid" 2>/dev/null; do
    print_new_stack_events "$stack_name" "$seen_file" "$snapshot_file"
    if [[ "$events_printed" == "true" ]]; then
      last_feedback=$SECONDS
    elif (( SECONDS - last_feedback >= 20 )); then
      stack_status="$(aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query 'Stacks[0].StackStatus' \
        --output text \
        "${aws_args[@]}" 2>/dev/null || true)"
      [[ -n "$stack_status" && "$stack_status" != "None" ]] || \
        stack_status="preparando change set"
      echo "  [$(date '+%H:%M:%S')] aguardando CloudFormation: $stack_status"
      last_feedback=$SECONDS
    fi
    sleep 4
  done

  if wait "$command_pid"; then
    command_status=0
  else
    command_status=$?
  fi
  print_new_stack_events "$stack_name" "$seen_file" "$snapshot_file"

  if (( command_status != 0 )); then
    echo
    echo "O CloudFormation encerrou com erro:" >&2
    cat "$command_log" >&2
  fi

  rm -r "$watch_dir"
  return "$command_status"
}

apply_component() {
  local component="$1"
  local template_path="${script_dir}/components/${component}.yaml"
  local deploy_template="$template_path"
  local stack_name
  local packaged_template=""
  local allowed_origin=""
  stack_name="$(component_stack_name "$component")"

  [[ -f "$template_path" ]] || fail "componente nao encontrado: $component"

  recover_failed_stack "$stack_name"

  if [[ "$component" == "marketplace-backend" ]]; then
    prepare_backend_packages
    ensure_artifacts_bucket
    packaged_template="$(mktemp "${TMPDIR:-/tmp}/residencia-marketplace-backend.XXXXXX")"
    aws cloudformation package \
      --template-file "$template_path" \
      --s3-bucket "$artifacts_bucket" \
      --output-template-file "$packaged_template" \
      "${aws_args[@]}" >/dev/null
    deploy_template="$packaged_template"
    allowed_origin="$(stack_output "$(component_stack_name web-edge)" FrontendUrl)"
  fi

  echo "Criando ou atualizando o componente $component..."
  if [[ "$component" == "marketplace-backend" ]]; then
    run_with_stack_events "$stack_name" \
      aws cloudformation deploy \
        --stack-name "$stack_name" \
        --template-file "$deploy_template" \
        --parameter-overrides "AllowedOrigin=${allowed_origin}" \
        --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
        --no-fail-on-empty-changeset \
        --tags ManagedBy=residencia-catch-up Baseline="$baseline" Component="$component" \
        "${aws_args[@]}"
    rm -f "$packaged_template"
  else
    run_with_stack_events "$stack_name" \
      aws cloudformation deploy \
        --stack-name "$stack_name" \
        --template-file "$deploy_template" \
        --no-fail-on-empty-changeset \
        --tags ManagedBy=residencia-catch-up Baseline="$baseline" Component="$component" \
        "${aws_args[@]}"
  fi
  echo "Componente $component pronto."
}

recover_failed_stack() {
  local stack_name="$1"
  local status
  status="$(aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query 'Stacks[0].StackStatus' \
    --output text \
    "${aws_args[@]}" 2>/dev/null || true)"

  if [[ "$status" == "ROLLBACK_COMPLETE" ]]; then
    echo "A stack $stack_name ficou em ROLLBACK_COMPLETE. Removendo antes de tentar novamente..."
    delete_stack_and_wait "$stack_name"
  fi
}

prepare_backend_packages() {
  command -v npm >/dev/null 2>&1 || fail "npm nao encontrado"
  command -v dotnet >/dev/null 2>&1 || fail "dotnet nao encontrado"
  command -v zip >/dev/null 2>&1 || fail "zip nao encontrado"
  echo "Empacotando as tres Lambdas da Sprint 2..."
  "${repository_dir}/backend/package.sh"
}

ensure_artifacts_bucket() {
  local account_id
  account_id="$(aws sts get-caller-identity --query Account --output text "${aws_args[@]}")"
  artifacts_bucket="${artifacts_bucket:-residencia-catchup-artifacts-${account_id}-${region}}"

  if aws s3api head-bucket --bucket "$artifacts_bucket" "${aws_args[@]}" >/dev/null 2>&1; then
    return
  fi

  echo "Criando bucket de artefatos $artifacts_bucket..."
  if [[ "$region" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$artifacts_bucket" "${aws_args[@]}" >/dev/null
  else
    aws s3api create-bucket \
      --bucket "$artifacts_bucket" \
      --create-bucket-configuration "LocationConstraint=${region}" \
      "${aws_args[@]}" >/dev/null
  fi
  aws s3api put-bucket-versioning \
    --bucket "$artifacts_bucket" \
    --versioning-configuration Status=Enabled \
    "${aws_args[@]}"
}

show_status() {
  local component
  local stack_name
  local status

  echo "Baseline: $baseline"
  while IFS= read -r component; do
    stack_name="$(component_stack_name "$component")"
    status="$(aws cloudformation describe-stacks \
      --stack-name "$stack_name" \
      --query 'Stacks[0].StackStatus' \
      --output text \
      "${aws_args[@]}")"
    echo "Componente: $component ($status)"
  done <<< "$components"

  if grep -qx "web-edge" <<< "$components"; then
    stack_name="$(component_stack_name web-edge)"
    echo "Frontend: $(stack_output "$stack_name" FrontendUrl)"
  fi
  if grep -qx "marketplace-backend" <<< "$components"; then
    stack_name="$(component_stack_name marketplace-backend)"
    echo "API: $(stack_output "$stack_name" ApiUrl)"
    echo "Cognito user pool: $(stack_output "$stack_name" UserPoolId)"
  fi
}

assert_baseline_ready() {
  local component
  local stack_name
  local status

  while IFS= read -r component; do
    stack_name="$(component_stack_name "$component")"
    if ! status="$(aws cloudformation describe-stacks \
      --stack-name "$stack_name" \
      --query 'Stacks[0].StackStatus' \
      --output text \
      "${aws_args[@]}" 2>/dev/null)"; then
      echo "Erro: o componente $component nao esta mais disponivel." >&2
      return 1
    fi

    case "$status" in
      CREATE_COMPLETE | UPDATE_COMPLETE) ;;
      *)
        echo "Erro: o componente $component terminou em $status." >&2
        return 1
        ;;
    esac
  done <<< "$components"
}

publish_site() {
  local stack_name
  local bucket_name
  local distribution_id
  stack_name="$(component_stack_name web-edge)"
  bucket_name="$(stack_output "$stack_name" FrontendBucketName)"
  distribution_id="$(stack_output "$stack_name" CloudFrontDistributionId)"

  command -v npm >/dev/null 2>&1 || fail "npm nao encontrado"

  echo "Gerando o frontend..."
  npm --prefix "${repository_dir}/site" ci
  if grep -qx "marketplace-backend" <<< "$components"; then
    local backend_stack_name
    backend_stack_name="$(component_stack_name marketplace-backend)"
    VITE_APP_MODE=production \
    VITE_AWS_REGION="$region" \
    VITE_COGNITO_USER_POOL_ID="$(stack_output "$backend_stack_name" UserPoolId)" \
    VITE_COGNITO_CLIENT_ID="$(stack_output "$backend_stack_name" UserPoolClientId)" \
    VITE_API_URL="$(stack_output "$backend_stack_name" ApiUrl)" \
      npm --prefix "${repository_dir}/site" run build
  else
    VITE_APP_MODE=mock npm --prefix "${repository_dir}/site" run build
  fi

  echo "Publicando os arquivos no S3..."
  aws s3 sync "${repository_dir}/site/dist" "s3://${bucket_name}" \
    --delete \
    "${aws_args[@]}"

  echo "Invalidando o cache do CloudFront..."
  aws cloudfront create-invalidation \
    --distribution-id "$distribution_id" \
    --paths "/*" \
    "${aws_args[@]}" >/dev/null
}

delete_stack_and_wait() {
  local stack_name="$1"
  aws cloudformation delete-stack --stack-name "$stack_name" "${aws_args[@]}"
  aws cloudformation wait stack-delete-complete \
    --stack-name "$stack_name" \
    "${aws_args[@]}"
}

destroy_component() {
  local component="$1"
  local stack_name
  local bucket_name
  stack_name="$(component_stack_name "$component")"

  if [[ "$component" == "web-edge" ]]; then
    bucket_name="$(stack_output "$stack_name" FrontendBucketName)"
    echo "Removendo os arquivos do bucket..."
    aws s3 rm "s3://${bucket_name}" --recursive "${aws_args[@]}"
  fi

  echo "Removendo o componente $component..."
  run_with_stack_events "$stack_name" \
    delete_stack_and_wait "$stack_name"
}

case "$action" in
  apply)
    aws sts get-caller-identity "${aws_args[@]}" >/dev/null
    while IFS= read -r component; do
      apply_component "$component"
    done <<< "$components"
    assert_baseline_ready

    if [[ "$publish_frontend" == "true" ]]; then
      grep -qx "web-edge" <<< "$components" || fail \
        "publish_frontend exige o componente web-edge"
      publish_site
    fi

    assert_baseline_ready
    echo
    echo "Catch-up concluido."
    show_status
    ;;
  status)
    show_status
    ;;
  destroy)
    aws sts get-caller-identity "${aws_args[@]}" >/dev/null
    while IFS= read -r component; do
      destroy_component "$component"
    done < <(printf '%s\n' "$components" | awk '{ line[NR] = $0 } END { for (i = NR; i >= 1; i--) print line[i] }')
    echo "Catch-up removido."
    ;;
esac
