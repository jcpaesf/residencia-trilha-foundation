# Catch-up de infraestrutura

Este diretório prepara o resultado funcional de uma sprint anterior para quem
entra na Residência com a turma já em andamento. Ele não substitui o laboratório
nem marca a sprint anterior como concluída.

## Estrutura

```text
catch-up/
├── baselines/                       # pontos de entrada cumulativos
│   └── ready-for-sprint-02.yaml     # seleciona o resultado da Sprint 1
├── components/                      # capacidades reutilizáveis
│   └── web-edge.yaml                # S3 e CloudFront
└── bootstrap.sh                     # aplica os componentes do baseline
```

Um baseline representa o ambiente necessário para entrar em uma sprint. Quando
os próximos catch-ups forem adicionados, `ready-for-sprint-03` poderá selecionar
`web-edge` e o componente da API, sem exigir que a pessoa execute dois comandos.

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
