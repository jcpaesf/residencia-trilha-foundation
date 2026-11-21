# Sprint 5 · Terraform: backend remoto no S3, CDN e domínio customizado

Este é o **esqueleto inicial do mentorado**, não a solução preenchida.
Todos os arquivos `.tf` vêm apenas com comentários, sem blocos ativos.
Siga a [Sprint 5 no Residência App](https://residenciapp.devopsnanuvem.com/?sprint=5)
e preencha cada arquivo pelos botões **Ver trecho Terraform**.

## Duas stacks e quinze arquivos

```text
stacks/
├── 00-remote-backend-stack/
│   ├── versions.tf
│   ├── variables.tf               # reservado ao opcional 1
│   ├── s3.bucket.tf
│   └── outputs.tf
└── 01-frontend-stack/
    ├── versions.tf
    ├── variables.tf               # reservado ao opcional 1
    ├── backend.tf
    ├── s3.bucket.tf
    ├── cloudfront.oac.tf
    ├── cloudfront.distribution.tf
    ├── acm.certificate.tf
    ├── acm.validation.tf
    ├── route53.zone.tf
    ├── route53.alias.tf
    └── outputs.tf
```

Uma pasta é uma root stack: o Terraform lê seus `.tf` juntos. Os `locals` dos
CNAMEs ficam em `acm.validation.tf`, sem um `locals.tf` separado.

## Como preencher o esqueleto

1. Preencha `versions.tf` de cada stack antes do respectivo `terraform init`.
2. O roteiro usa **um único provider AWS por stack**, na **mesma conta**, em
   **us-east-1**. Não há aliases, troca de conta nem provider separado para DNS.
   Usamos essa região para que o certificado do CloudFront possa usar o mesmo provider.
3. No fluxo principal, preencha os valores **diretamente nos blocos**. Substitua
   os placeholders inteiros, incluindo `<` e `>`:
   `<YOUR_ACCOUNT>`, `<YOUR_PROFILE>`, `<YOUR_STATE_BUCKET>`,
   `<YOUR_FRONTEND_BUCKET>`, `<YOUR_DNS_ZONE>`, `<YOUR_DOMAIN>` e `<YOUR_OAC_NAME>`.
4. Use nomes novos de bucket e um subdomínio novo de uma zona pública que você
   administra na mesma conta. Repita o MESMO `<YOUR_DOMAIN>` no certificado,
   na validação, no CloudFront e no A Alias.
5. Adicione os trechos de um mesmo arquivo sem apagar os anteriores. Não declare
   o mesmo endereço duas vezes. Não execute `apply` antes de concluir e revisar o plano.

**Variables não faz parte do caminho obrigatório.** Deixe `variables.tf` apenas
com os comentários inicialmente. O opcional 1 é extrair os parâmetros do ambiente
para esse arquivo, substituir os literais por `var.*` e comprovar `No changes`.
O backend continua com valores literais: ele não aceita `var.*`.

## Ordem de execução

Na stack `00`, implemente o provider e execute:

```bash
cd infrastructure/terraform/stacks/00-remote-backend-stack
terraform init
```

Preencha os cinco recursos do bucket e os outputs pelo roteiro. Então:

```bash
terraform fmt
terraform validate
terraform plan
terraform apply
terraform output
terraform plan -detailed-exitcode
```

Antes do apply, o plano deve mostrar **5 to add, 0 to change, 0 to destroy**.
O último plano deve mostrar `No changes`. Esta stack mantém **state local**:
guarde-o com segurança, fora do Git.

Na stack `01`, preencha `versions.tf` e **backend.tf antes do init**. O bucket
e a região vêm dos outputs da stack `00`. Use a chave própria
`residencia-foundation/01-frontend-stack.tfstate`, `encrypt = true` e
`use_lockfile = true`. Não copie o state local da outra stack nem use `-migrate-state`.
Aguarde a propagação do versionamento do bucket novo antes de gravar nele;
a AWS recomenda 15 minutos.

O Terraform gerencia o objeto `<key>.tflock` para impedir operações concorrentes.
O profile precisa ler/gravar o state e de `s3:GetObject`, `s3:PutObject` e
`s3:DeleteObject` nesse objeto de lock. Não crie o lock manualmente.

```bash
cd ../01-frontend-stack
terraform init
```

Preencha os recursos S3, ACM, validação DNS, OAC, CloudFront, A Alias e outputs.
O certificado e os CNAMEs são novos; a zona DNS existente é apenas consultada.
Depois execute `fmt`, `validate` e `plan`. Para um domínio, espere **11 to add,
0 to change, 0 to destroy**. Revise a conta, os custos e o escopo antes do `apply`.
Confira os outputs e rode outro `plan` para comprovar `No changes`.

## Publicação, Git e limpeza

- O App fornece os comandos para gerar `site/dist/` em modo mock, publicar no
  bucket WEB e invalidar o CloudFront. Terraform não faz upload do build.
- Confira HTTPS, domínio customizado, assets e refresh de rota. A leitura anônima
  direta do mesmo `index.html` no S3 deve retornar 403.
- Não há imports, states, caches, contas do instrutor ou solução paralela em
  `examples/` nesta base. Não altere os recursos ou pipelines das sprints anteriores.
- Versione código e `.terraform.lock.hcl` gerado pelo init. Não versione states,
  planos binários, `.terraform/` ou credenciais.
- Para limpar um laboratório que VOCÊ criou, revise `terraform plan -destroy`.
  Remova primeiro o frontend, esvaziando apenas o bucket web e retirando
  `prevent_destroy` apenas dos recursos que pretende excluir. Só então use destroy.
- O bucket de state é o último; preserve seus dados enquanto houver dependentes.
  Como é versionado, apagar apenas os objetos atuais não o esvazia. Não apague o
  state antes de comprovar a remoção dos recursos.

Documentação: [backend S3](https://developer.hashicorp.com/terraform/language/backend/s3),
[variables](https://developer.hashicorp.com/terraform/language/values/variables),
[versionamento S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/manage-versioning-examples.html).
