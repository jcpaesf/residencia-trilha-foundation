# Antes do terraform init, adicione o trecho backend.tf completo do App.
# Preencha bucket, key, region, profile e allowed_account_ids do laboratório.
# O bucket e a região vêm dos outputs da 00-remote-backend-stack já aplicada.
# Não use var.* nem copie o state local da stack anterior.
# Inclua use_lockfile = true para bloquear operações concorrentes no state.
