locals {
  create_bootstrap_user = var.enable_userpass_auth && var.vault_bootstrap_username != "" && var.vault_bootstrap_password != ""
}

# Requires VAULT_ADDR and VAULT_TOKEN in the environment when enabled.
resource "vault_auth_backend" "userpass" {
  count = var.enable_userpass_auth ? 1 : 0
  type  = "userpass"
}

resource "vault_policy" "files_reader" {
  count  = var.enable_userpass_auth ? 1 : 0
  name   = "vault-files-reader"
  policy = <<EOF
path "secret/metadata/files" {
  capabilities = ["list", "read"]
}

path "secret/metadata/files/*" {
  capabilities = ["list", "read"]
}

path "secret/data/files/*" {
  capabilities = ["read"]
}
EOF
}

# Optional bootstrap user; for ongoing user management use scripts/create-user.sh.
resource "vault_generic_endpoint" "bootstrap_user" {
  count        = local.create_bootstrap_user ? 1 : 0
  path         = "auth/${vault_auth_backend.userpass[0].path}/users/${var.vault_bootstrap_username}"
  disable_read = true
  data_json = jsonencode({
    password = var.vault_bootstrap_password
    policies = vault_policy.files_reader[0].name
  })
}
