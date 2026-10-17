# Backend do marketplace, Sprints 2 e 3

O backend entrega o mesmo fluxo de catálogo e pedidos por dois adapters
explícitos. Na Sprint 2, o estado fica no Amazon DynamoDB. Na Sprint 3,
`DATA_SOURCE=rds` seleciona PostgreSQL por meio do RDS Proxy. Trocar o adapter
não muda os handlers HTTP e nunca dispara fallback ou dual write silencioso.

## Fluxo

```text
React SPA
  -> Cognito: cadastro, confirmação e login
  -> API Gateway REST API + Cognito user pool authorizer
      -> catalog-backend-api-lambda
          -> DynamoDB: produtos
          -> S3: URL pré-assinada da imagem
      -> order-backend-api-lambda
          -> DynamoDB: consulta produto e grava pedido pending
          -> SQS: publica OrderCreated
              -> order-processor-lambda
                  -> DynamoDB TransactWrite: baixa estoque + confirma pedido
```

Uma conta autenticada pode comprar e vender. O `sub` do JWT identifica o
usuário como seller ao cadastrar um produto e como buyer ao realizar uma
compra. Não é necessário adicionar usuários a grupos manualmente no Cognito.

## Nomes sugeridos

| Recurso | Nome |
| --- | --- |
| User pool | `residencia-foundation-users` |
| API Gateway REST API | `residencia-foundation-rest-api` |
| Tabela DynamoDB | `residencia-foundation-marketplace` |
| Lambda de catálogo | `catalog-backend-api-lambda` |
| Lambda de pedidos | `order-backend-api-lambda` |
| Lambda processadora | `order-processor-lambda` |
| Bucket de imagens | `residencia-foundation-product-images-<account-id>` |
| Fila principal | `order-events-queue` |
| Dead-letter queue | `order-events-dlq` |

## Tabela DynamoDB

Crie a tabela com billing mode **On-demand** e apenas uma chave:

| Nome | Tipo | Uso |
| --- | --- | --- |
| `pk` | String | Partition key da tabela |

Não há sort key nem GSI nesta sprint. Os produtos são gravados com
`pk=PRODUCT#<id>` e os pedidos com `pk=ORDER#<id>`. As listagens usam `Scan`
com filtros, uma decisão intencional para manter o laboratório simples. Esse
acesso não é o desenho indicado para uma tabela grande e será substituído pela
camada de RDS em uma sprint posterior.

A Lambda de pedidos grava o item com status `pending` antes de publicar o evento
na SQS. A Lambda processadora usa `TransactWriteItems` para que a baixa do
estoque e a mudança do pedido para `processed` aconteçam juntas. Assim, a tela
de pedidos lê o estado real do DynamoDB durante todo o processamento.
O pedido também registra `buyerName` e `buyerEmail` a partir dos claims do ID
token para que o vendedor identifique quem realizou a compra. Itens antigos,
que possuem somente `buyerId`, continuam compatíveis com a listagem.

Cada item de produto mantém `imageKeys`, uma lista com até oito chaves do S3.
A Lambda de catálogo gera uma URL de upload para cada arquivo e URLs temporárias
de leitura para montar o carrossel no frontend.

## Rotas do API Gateway

Todos os métodos usam o Cognito user pool authorizer. Como esta sprint não cria
resource server nem scopes customizados, a SPA envia o ID token no header
`Authorization`; os claims ficam disponíveis em
`requestContext.authorizer.claims` nas integrações Lambda proxy.

| Método | Rota | Integração |
| --- | --- | --- |
| `GET` | `/products` | Lambda de catálogo |
| `POST` | `/products` | Lambda de catálogo |
| `PUT` | `/products/{id}` | Lambda de catálogo |
| `DELETE` | `/products/{id}` | Lambda de catálogo |
| `GET` | `/orders` | Lambda de pedidos |
| `POST` | `/orders` | Lambda de pedidos |
| `GET` | `/seller/orders` | Lambda de pedidos |

As quatro operações de produto continuam na mesma Lambda de catálogo. Configure
CORS na REST API exige um método `OPTIONS` sem authorizer em cada recurso e os
headers `Access-Control-Allow-*` nas respostas das Lambdas proxy. O código já
devolve esses headers usando `ALLOWED_ORIGIN`; configure a origem do CloudFront
nas duas Lambdas HTTP.

## Variáveis de ambiente

### Lambda de catálogo

```env
DATA_SOURCE=dynamodb
MARKETPLACE_TABLE_NAME=residencia-foundation-marketplace
PRODUCT_IMAGES_BUCKET=residencia-foundation-product-images-<account-id>
UPLOAD_URL_TTL_SECONDS=900
DOWNLOAD_URL_TTL_SECONDS=3600
ALLOWED_ORIGIN=https://seu-dominio.com
```

### Lambda de pedidos

```env
DATA_SOURCE=dynamodb
MARKETPLACE_TABLE_NAME=residencia-foundation-marketplace
ORDER_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/<account-id>/order-events-queue
ALLOWED_ORIGIN=https://seu-dominio.com
```

### Lambda processadora

```env
DATA_SOURCE=dynamodb
MARKETPLACE_TABLE_NAME=residencia-foundation-marketplace
```

### Modo RDS da Sprint 3

As três Lambdas recebem as variáveis abaixo quando `DATA_SOURCE=rds`. `DB_HOST`
é sempre o endpoint privado do RDS Proxy. O runtime lê `username` e `password`
do JSON apontado por `DB_SECRET_ARN`; não configure `DB_USER`, `DB_PASSWORD` ou
uma connection string completa na função.

```env
DATA_SOURCE=rds
DB_HOST=<endpoint-do-rds-proxy>
DB_PORT=5432
DB_NAME=marketplace
DB_SECRET_ARN=<arn-do-secret>
DB_SSL=true
```

O schema versionado está em `backend/sql/001_marketplace.sql`. Aplique-o de um
cliente `psql` com acesso à VPC. O banco e o Proxy permanecem privados.

Para validar localmente o schema e os três adapters RDS com um PostgreSQL 16
isolado, execute `./backend/test-rds-local.sh`. O teste usa uma credencial local
somente quando `ALLOW_LOCAL_DB_SECRET=true`; essa opção não deve ser configurada
nas Lambdas publicadas, que continuam exigindo `DB_SECRET_ARN`.

Depois de aplicar o catch-up da Sprint 2, execute `./backend/test-deployed.sh`
para validar o ambiente publicado. O teste cria um usuário temporário no
Cognito, exercita catálogo, upload no S3, criação e processamento do pedido,
confere a atualização do estoque e remove os dados criados ao terminar.

As Lambdas usam duas subnets privadas. Para preservar o modo DynamoDB e as
integrações existentes sem NAT, a VPC precisa de Gateway endpoints para S3 e
DynamoDB e Interface endpoints para SQS e Secrets Manager. Um Internet Gateway
sozinho não fornece saída IPv4 às ENIs privadas da Lambda e não faz parte do
desenho obrigatório da Sprint 3.

## Permissões mínimas

- catálogo: `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:DeleteItem`,
  `dynamodb:Scan`, `s3:PutObject`, `s3:GetObject` e `s3:DeleteObject` nos
  recursos do laboratório;
- pedidos: `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:Scan` e
  `sqs:SendMessage`;
- processadora: `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`,
  `dynamodb:TransactWriteItems` e permissão para consumir a fila por meio do
  event source mapping;
- modo RDS: `secretsmanager:GetSecretValue` restrito ao secret do banco e as
  permissões de ENI fornecidas por `AWSLambdaVPCAccessExecutionRole`;
- CloudWatch Logs para as três funções.

O bucket deve aceitar PUT pelo CORS da origem do frontend, com o cabeçalho
`Content-Type`. Ele continua privado: upload e leitura são feitos por URLs
pré-assinadas de curta duração.

## Handlers

```text
01-catalog-backend-api-lambda: index.handler
02-order-backend-api-lambda:   Residencia.Foundation.Orders::Residencia.Foundation.Orders.Function::FunctionHandler
03-order-processor-lambda:     index.handler
```

## Empacotamento

Cada Lambda possui sua própria pasta, sua própria saída `dist` e seu próprio
ZIP. Nas Lambdas TypeScript, `npm run build` transpila e reúne o código e as
dependências em `dist/index.mjs`. Compacte o **conteúdo** de `dist`, para que
`index.mjs` fique na raiz do ZIP:

```bash
cd backend/lambdas/01-catalog-backend-api-lambda
npm install
npm run build
cd dist && zip -r ../catalog-backend-api-lambda.zip . && cd ..

cd ../03-order-processor-lambda
npm install
npm run build
cd dist && zip -r ../order-processor-lambda.zip . && cd ..
```

A Lambda de pedidos permanece em .NET 8. Nela, `dotnet publish` gera os
artefatos compilados e as dependências em `dist`; compacte também o conteúdo
da pasta, não a pasta em si:

```bash
cd backend/lambdas/02-order-backend-api-lambda
rm -rf dist order-backend-api-lambda.zip
dotnet publish OrderBackendApi.csproj --configuration Release --output dist
cd dist && zip -r ../order-backend-api-lambda.zip . && cd ..
```

Como atalho, execute `./backend/package.sh` na raiz do repositório. Ele repete
os três fluxos e deixa cada ZIP dentro da pasta da Lambda correspondente.
