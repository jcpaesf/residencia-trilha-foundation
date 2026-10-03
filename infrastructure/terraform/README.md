# Terraform da trilha

Este diretório recebe somente a infraestrutura criada nas sprints em que
Terraform já faz parte do conteúdo. Ele não prepara pontos de entrada e não usa
profiles `ready-for-sprint`: essa responsabilidade pertence ao `catch-up`.

## Estrutura

```text
terraform/
├── bootstrap.sh       # executa uma root stack explicitamente
├── foundation/        # preparação do remote state quando ela entrar na trilha
└── stacks/            # root stacks adicionadas conforme as sprints avançam
```

Cada diretório dentro de `stacks` é uma root stack independente e mantém sua
própria chave de state. Os diretórios só devem ser adicionados quando a stack
for introduzida na trilha; não há placeholders para implementações futuras.

Depois que uma stack existir, use:

```bash
RESIDENCIA_STATE_BUCKET=meu-state-bucket \
  ./infrastructure/terraform/bootstrap.sh plan 01-web-edge

RESIDENCIA_STATE_BUCKET=meu-state-bucket \
  ./infrastructure/terraform/bootstrap.sh apply 01-web-edge
```

O segundo argumento é sempre o nome explícito da stack. Para remover:

```bash
RESIDENCIA_STATE_BUCKET=meu-state-bucket \
  ./infrastructure/terraform/bootstrap.sh destroy 01-web-edge
```
