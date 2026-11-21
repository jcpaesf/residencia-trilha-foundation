# Foundation do Terraform

A preparação do bucket faz parte da root stack
`../stacks/00-remote-backend-stack`. Ela usa state local no bootstrap. O lock
é ativado na `01-frontend-stack` por `use_lockfile = true`, sem tabela DynamoDB.
