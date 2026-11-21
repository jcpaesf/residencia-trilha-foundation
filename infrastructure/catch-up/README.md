# Catch-up de infraestrutura

Este diretório prepara o resultado funcional de uma sprint anterior para quem
entra na Residência com a turma já em andamento. Ele não substitui o laboratório
nem marca a sprint anterior como concluída.

## Estrutura

```text
catch-up/
├── baselines/                       # pontos de entrada cumulativos
│   ├── ready-for-sprint-02.yaml     # seleciona o resultado da Sprint 1
│   ├── ready-for-sprint-03.yaml     # seleciona o resultado da Sprint 2
│   ├── ready-for-sprint-04.yaml     # seleciona o resultado da Sprint 3
│   └── ready-for-sprint-05.yaml     # seleciona a Sprint 4, incluindo IAM/OIDC
├── components/                      # capacidades reutilizáveis
│   ├── web-edge.yaml                # S3 e CloudFront
│   ├── marketplace-backend.yaml     # Cognito, API, Lambdas, DynamoDB e SQS
│   ├── marketplace-backend-rds.yaml # VPC, endpoints, RDS e Proxy
│   └── pipeline-identity.yaml       # OIDC e roles de deploy
└── bootstrap.sh                     # aplica os componentes do baseline
```

Um baseline representa o ambiente necessário para entrar em uma sprint. Quando
um baseline possui mais de um componente, o bootstrap aplica todos na ordem
correta e publica o frontend já configurado para o ambiente criado.

## Entrada na Sprint 5: resultado até a Sprint 4

`ready-for-sprint-05` usa **DynamoDB por padrão** e acrescenta a
**configuração AWS das pipelines**. Os workflows já estão em `.github/workflows/`.
O novo componente:

- cria o provider GitHub OIDC somente se ele não existir; reutiliza um provider
  existente sem sobrescrever audiences ou thumbprints;
- cria uma role de frontend, restrita ao bucket web e à distribuição do catch-up;
- cria uma role de backend, restrita ao deploy de código das três Lambdas;
- restringe ambas à audience `sts.amazonaws.com` e ao subject exato do fork na main;
- gera as 13 Repository Variables, sem credenciais, em
  `build/catch-up/<PREFIXO>/repository-variables.env` e `.json`.

O comando **não** grava no GitHub e não dispara workflows. Após revisar o arquivo,
com `gh` autenticado, importe as variables pelo comando impresso ao final.
Os workflows continuam usando push na main e `workflow_dispatch`.

### Subject OIDC do fork

Use o subject real da sua conta/repositório, não copie o subject do instrutor.
Repositórios novos podem incluir IDs imutáveis. Consulte:

```bash
gh api 'repos/<YOUR_OWNER>/<YOUR_REPOSITORY>/actions/oidc/customization/sub'
```

Se a resposta tiver `sub_claim_prefix`, acrescente `:ref:refs/heads/main` a esse
prefixo. No formato tradicional, use `repo:OWNER/REPO:ref:refs/heads/main`;
no imutável, `repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:refs/heads/main`.
Uma configuração personalizada exige conferir os claims reais. Não altere o
subject do repositório nem use curingas para contornar falhas.

```bash
AWS_PROFILE='<YOUR_PROFILE>' AWS_REGION=us-east-1 \
  CATCH_UP_EXPECTED_ACCOUNT_ID='<YOUR_ACCOUNT>' \
  CATCH_UP_GITHUB_REPO='<YOUR_OWNER>/<YOUR_REPOSITORY>' \
  CATCH_UP_GITHUB_SUB='<YOUR_EXACT_OIDC_SUBJECT_FOR_MAIN>' \
  ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-05
```

O `plan ready-for-sprint-05` valida os três templates localmente, sem criar recursos.
O apply verifica a conta e os parâmetros antes de criar qualquer componente.
Sem `CATCH_UP_DATA_SOURCE=rds`, não cria RDS, Proxy, VPC nem endpoints.
DynamoDB usa cobrança por uso; isso não significa que o laboratório seja gratuito.

RDS é opcional e exige os dois parâmetros explícitos, além dos anteriores:

```bash
# Acrescente ao comando apply somente quando quiser o laboratório SQL:
# CATCH_UP_DATA_SOURCE=rds
# CATCH_UP_POSTGRES_VERSION='<YOUR_POSTGRES_16_VERSION>'
```

Não basta informar uma versão de PostgreSQL: somente `CATCH_UP_DATA_SOURCE=rds`
habilita os recursos SQL e seus custos contínuos.

### Isolamento e atualização

O prefixo de stack sozinho não muda nomes físicos das Lambdas e imagens. Para
um **laboratório novo**, use conjuntamente `CATCH_UP_STACK_PREFIX` e
`CATCH_UP_RESOURCE_PREFIX` (2 a 24 caracteres); para isolar também os pacotes,
informe `CATCH_UP_ARTIFACTS_BUCKET`. Sem esses valores, os defaults anteriores
continuam sendo usados, preservando a compatibilidade do baseline 04.
Não troque o prefixo físico de um ambiente existente sem revisar substituições.

Aplicar 05 sobre o mesmo prefixo de 04 atualiza as stacks existentes e adiciona
IAM. Pode republicar os ZIPs do catch-up e, no opt-in RDS, reinvocar o schema idempotente; revise
antes de usar em um ambiente que recebeu releases posteriores.

Esta preparação não implementa a Sprint 5 pelo mentorado: as duas stacks Terraform
do exercício continuam vazias, e o laboratório Terraform cria outra camada web,
sem importar nem disputar o gerenciamento dos recursos do catch-up.

### Teste real na AWS

Use um laboratório descartável e identificado, com o mesmo prefixo aplicado:

```bash
AWS_PROFILE='<YOUR_PROFILE>' AWS_REGION=us-east-1 \
  CATCH_UP_EXPECTED_ACCOUNT_ID='<YOUR_ACCOUNT>' \
  CATCH_UP_STACK_PREFIX='<YOUR_TEST_STACK_PREFIX>' \
  CATCH_UP_GITHUB_SUB='<YOUR_EXACT_OIDC_SUBJECT_FOR_MAIN>' \
  node infrastructure/catch-up/tests/aws-ready-for-sprint-05.mjs
```

O teste confere as stacks, os hashes dos três ZIPs publicados, a trust policy e permissões positivas/negativas via
IAM Policy Simulator. Depois valida HTTPS, S3 privado, login Cognito, catálogo em
DynamoDB, upload/leitura de imagem, pedido .NET, SQS, processamento e estoque.
Confirma também que o padrão não criou RDS, Proxy, VPC nem endpoints. Para testar
um ambiente SQL criado por opt-in, informe `CATCH_UP_DATA_SOURCE=rds` também no teste.
Ele cria dados sintéticos no laboratório e remove o usuário de teste; produto,
pedido e imagem ficam para a limpeza do ambiente descartável. O relatório em
`build/catch-up/<PREFIXO>/aws-test-report.json` não contém senhas ou tokens.
Esse teste não é uma execução GitHub Actions e não prova troca de token OIDC real.

### Limpeza e runtime

O destroy automático de RDS continua bloqueado. Remova apenas as stacks exatas de
teste, IAM primeiro, backend depois e frontend por último; esvazie somente os
buckets desse teste. A remoção de RDS gera snapshot, que deve ser conferido e
removido se o laboratório for realmente descartável. Artefatos versionados exigem
remover todas as versões e delete markers antes de excluir o bucket.

O provider OIDC existente nunca é excluído. Se este catch-up criar o provider,
ele fica retido por segurança ao excluir a stack: outros repositórios podem
passar a utilizá-lo. Só exclua manualmente se comprovar que é exclusivo do teste
e que nenhuma outra role o referencia.
O provider é compartilhado pela conta: criar um provider ausente também pode
reativar trusts de roles antigas que já apontem para esse ARN. Revise essas
referências antes de aplicar em uma conta que já recebeu outros laboratórios.

O backend existente usa .NET 8, depreciado desde 10/11/2026, ainda com criação
permitida pela AWS. A exceção do lint W2531 é limitada à Lambda de pedidos;
as demais validações continuam ativas. A migração para .NET 10 é uma tarefa
separada e deve ocorrer antes dos bloqueios publicados pela AWS.

Referências: [OIDC GitHub/AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws),
[runtimes Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html).

## Entrada na Sprint 4: resultado até a Sprint 3

`ready-for-sprint-04` usa os mesmos componentes e nomes de stack da Sprint 2.
O padrão é `marketplace-backend.yaml`, com Cognito, API, DynamoDB, imagens e filas,
sem banco relacional nem rede privada com endpoints pagos.

### RDS opcional — somente por parâmetro explícito

Com `CATCH_UP_DATA_SOURCE=rds`, o componente usa `marketplace-backend-rds.yaml`.
Preserva Cognito, API, DynamoDB, imagens e filas, e acrescenta:

- VPC, duas subnets privadas, route table e associações;
- Gateway endpoints S3/DynamoDB e Interface endpoints SQS/Secrets Manager com DNS privado;
- security groups encadeados Lambda → Proxy → RDS;
- PostgreSQL 16 privado, secret gerenciado, RDS Proxy com TLS;
- três Lambdas em VPC com DATA_SOURCE=rds e credencial obtida pelo Secrets Manager;
- inicializador SQL invocado explicitamente depois que o Proxy fica disponível.

Não há NAT, Internet Gateway ou banco público. RDS, Proxy e endpoints geram
custos contínuos. O laboratório usa instância single-AZ; não é um desenho de
alta disponibilidade de produção. Credencial administrativa é compartilhada
com as funções neste laboratório; em produção, separe usuários/permissões.

Valide localmente (SAM CLI atualizado; não executa deploy):

O SAM CLI precisa reconhecer o runtime `nodejs24.x`. Se a validação rejeitar
esse runtime, atualize o SAM CLI antes de continuar; não altere o runtime do
template para contornar uma instalação antiga. O empacotamento também exige
Node.js 24, .NET SDK 8 e `zip` instalados.

```bash
./infrastructure/catch-up/bootstrap.sh plan ready-for-sprint-04
```

Para aplicar **o opcional RDS após revisão**, escolha uma versão PostgreSQL 16 disponível e
suportada por RDS Proxy na sua região, e confirme a conta:

```bash
aws rds describe-db-engine-versions --engine postgres --query 'DBEngineVersions[].EngineVersion'
AWS_PROFILE=seu-profile AWS_REGION=us-east-1 \
  CATCH_UP_EXPECTED_ACCOUNT_ID=SUA_CONTA \
  CATCH_UP_DATA_SOURCE=rds \
  CATCH_UP_POSTGRES_VERSION=VERSAO_16_SUPORTADA \
  ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-04
```

Nesse modo SQL, o script empacota Node 24/.NET 8 arm64, aplica as stacks, aguarda o Proxy,
executa o SQL idempotente, valida as tabelas, publica frontend configurado e
aguarda a invalidação. Falhas no schema interrompem antes da publicação.
Contas Cognito existentes são preservadas no upgrade; dados DynamoDB **não**
são migrados para SQL. O novo banco começa vazio. Teste o fluxo funcional de
catálogo, imagem, pedido e processamento após terminar.

Se os recursos foram criados manualmente, não rode catch-up sobre eles: o SAM
não assume sua propriedade. Nos baselines 04/05, o default das Lambdas continua
sendo `residencia-fdn-*`. Para um laboratório novo isolado, informe também
`CATCH_UP_RESOURCE_PREFIX`, além do prefixo das stacks.

Não aplique o padrão DynamoDB sobre um ambiente RDS. O script bloqueia
essa conversão em qualquer baseline; mantenha `CATCH_UP_DATA_SOURCE=rds` para
reaplicar o ambiente SQL, ou escolha um novo prefixo isolado para DynamoDB.
Reaplicar o baseline 04 pode substituir código de releases
publicadas posteriormente pela pipeline; revise seus ZIPs antes de aplicar.

### Remoção do ambiente RDS

Destroy automático é bloqueado para proteger dados. Revise no CloudFormation
os recursos das stacks exatas, faça backup e decida sobre retenção antes de
remover. A instância RDS tem DeletionPolicy/UpdateReplacePolicy Snapshot.
Snapshots, buckets com imagens/artefatos e outros recursos retidos podem
continuar gerando custos. Guarde os dados necessários para restaurar o banco;
não presuma que o secret gerenciado continuará acessível após excluir a instância.
Uma stack em ROLLBACK_COMPLETE não é mais removida automaticamente: inspecione
os eventos e os recursos antes de decidir se deve apagá-la.

## Entrada na Sprint 3

O baseline `ready-for-sprint-03` reaproveita o `web-edge` e acrescenta o
resultado funcional da Sprint 2: Cognito, API Gateway REST, três Lambdas,
DynamoDB, bucket de imagens, SQS e DLQ. O bootstrap empacota o backend, publica
os artefatos e gera o frontend em modo AWS com os outputs das stacks.

```bash
AWS_PROFILE=seu-profile \
  ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-03
```

## Entrada na Sprint 2

O primeiro baseline cria somente a infraestrutura necessária para publicar o
frontend:

- bucket S3 privado;
- CloudFront com Origin Access Control;
- fallback de SPA para `index.html`;
- URL HTTPS padrão do CloudFront.

Não são criados domínio customizado, certificado ACM ou registros no Route 53.
O site é compilado com `VITE_APP_MODE=mock`, enviado ao bucket e tem o cache do
CloudFront invalidado automaticamente.

### Aplicar

Configure a AWS CLI e execute:

```bash
AWS_PROFILE=seu-profile \
  ./infrastructure/catch-up/bootstrap.sh apply ready-for-sprint-02
```

A criação da distribuição CloudFront normalmente leva alguns minutos. Ao final,
o script mostra a URL pública do frontend. Durante a espera, os eventos dos
recursos do CloudFormation aparecem no terminal; quando não há evento novo, um
sinal periódico mostra que a stack continua em andamento.

### Consultar

```bash
AWS_PROFILE=seu-profile \
  ./infrastructure/catch-up/bootstrap.sh status ready-for-sprint-02
```

### Remover

```bash
AWS_PROFILE=seu-profile \
  ./infrastructure/catch-up/bootstrap.sh destroy ready-for-sprint-02
```

O comando esvazia o bucket antes de remover a stack, porque o CloudFormation não
exclui buckets que ainda contenham objetos.
