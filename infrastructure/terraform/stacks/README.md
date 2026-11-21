# Root stacks · Ponto inicial da Sprint 5

- `00-remote-backend-stack`: bucket privado, criptografado e versionado para o state.
  Usa state local para não depender do bucket que cria.
- `01-frontend-stack`: nova camada web do laboratório. Usa o bucket anterior,
  locking nativo e a chave remota definida em `backend.tf`.

Todos os arquivos contêm apenas comentários. Preencha cada arquivo pelos trechos
da Sprint 5 no App, começando por versions.tf antes do init. Use um único provider
AWS por stack, na mesma conta, em us-east-1. O roteiro principal tem valores
literais; variables.tf fica reservado para o opcional 1.
Não há imports, providers ou recursos ativos nesta base. Complete também o
backend.tf antes do init da frontend stack.

Consulte [o guia da Sprint 5](../README.md) para a lista dos arquivos, a ordem
de execução e os cuidados com os dois states.
