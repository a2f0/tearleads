#!/usr/bin/env sh
set -eu

install_tailscale() {
  if has_cmd tailscale; then
    echo "Tailscale is already installed."
    return
  fi

  if [ "$OS" = "darwin" ]; then
    echo "Skipping Tailscale installation on macOS for now."
    echo "Install Tailscale manually, then re-run this script."
    return
  fi

  echo "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
  echo "Tailscale installed."
}

install_vault() {
  if has_cmd vault && vault_matches_required_version; then
    echo "Vault CLI $(vault_version) is already installed."
    return
  fi

  if has_cmd vault; then
    echo "Vault CLI $(vault_version) is installed but required version is ${REQUIRED_VAULT_VERSION}."
    echo "Upgrading/downgrading Vault CLI..."
  else
    echo "Installing Vault CLI..."
  fi

  if [ "$OS" = "darwin" ]; then
    (
      set -e
      vault_tmp_dir="$(install_darwin_hashicorp_zip "vault" "$REQUIRED_VAULT_VERSION")"
      trap 'rm -rf "$vault_tmp_dir"' EXIT
      target_vault_path="$(vault_cmd_path)"
      if [ -z "$target_vault_path" ]; then
        target_vault_path="/usr/local/bin/vault"
      fi
      install_binary_in_path "${vault_tmp_dir}/vault" "$target_vault_path"
    )
  else
    ensure_hashicorp_apt_repo
    vault_pkg_version="$(apt-cache madison vault | awk -v req="$REQUIRED_VAULT_VERSION" '$3 ~ ("^" req "-") { print $3; exit }')"
    if [ -z "$vault_pkg_version" ]; then
      echo "Required Vault version ${REQUIRED_VAULT_VERSION} is not available in apt repository." >&2
      echo "Available versions (top 10):" >&2
      apt-cache madison vault | awk '{ print $3 }' | head -n 10 >&2
      exit 1
    fi
    sudo apt-get install -y "vault=${vault_pkg_version}"
  fi

  if ! has_cmd vault || ! vault_matches_required_version; then
    resolved_version="$(vault_version)"
    resolved_path="$(vault_cmd_path)"
    echo "Vault installation failed: ${resolved_path:-vault not found} reports version ${resolved_version:-unknown}, expected ${REQUIRED_VAULT_VERSION}." >&2
    if [ -n "$resolved_path" ]; then
      echo "All vault binaries in PATH:" >&2
      which -a vault >&2 || true
    fi
    exit 1
  fi

  echo "Vault CLI $(vault_version) installed at $(vault_cmd_path)."
}

install_terraform() {
  terraform_bin="$(tool_cmd_path "terraform")"

  if has_cmd terraform && terraform_matches_required_version; then
    echo "Terraform $(terraform_version) is already installed."
    return
  fi

  if has_cmd terraform; then
    echo "Terraform $(terraform_version) is installed at ${terraform_bin:-unknown path} but required version is ${REQUIRED_TERRAFORM_VERSION}."
    echo "Upgrading Terraform..."
  else
    echo "Installing Terraform..."
  fi

  case "$terraform_bin" in
    *"/.tfenv/"*)
      if ! has_cmd tfenv; then
        echo "Terraform is managed by tfenv at ${terraform_bin}, but tfenv is not available in PATH." >&2
        exit 1
      fi
      echo "Detected tfenv-managed Terraform. Installing/selecting ${REQUIRED_TERRAFORM_VERSION} via tfenv..."
      tfenv install "${REQUIRED_TERRAFORM_VERSION}"
      tfenv use "${REQUIRED_TERRAFORM_VERSION}"
      ;;
    *)
      if [ "$OS" = "darwin" ]; then
        (
          set -e
          terraform_tmp_dir="$(install_darwin_hashicorp_zip "terraform" "$REQUIRED_TERRAFORM_VERSION")"
          trap 'rm -rf "$terraform_tmp_dir"' EXIT
          target_terraform_path="$(tool_cmd_path "terraform")"
          if [ -z "$target_terraform_path" ]; then
            target_terraform_path="/usr/local/bin/terraform"
          fi
          install_binary_in_path "${terraform_tmp_dir}/terraform" "$target_terraform_path"
        )
      else
        ensure_hashicorp_apt_repo
        terraform_pkg_version="$(apt-cache madison terraform | awk -v req="$REQUIRED_TERRAFORM_VERSION" '$3 ~ ("^" req "-") { print $3; exit }')"
        if [ -z "$terraform_pkg_version" ]; then
          echo "Required Terraform version ${REQUIRED_TERRAFORM_VERSION} is not available in apt repository." >&2
          echo "Available versions (top 10):" >&2
          apt-cache madison terraform | awk '{ print $3 }' | head -n 10 >&2
          exit 1
        fi
        sudo apt-get install -y "terraform=${terraform_pkg_version}"
      fi
      ;;
  esac

  if ! has_cmd terraform || ! terraform_matches_required_version; then
    terraform_bin="$(tool_cmd_path "terraform")"
    case "$terraform_bin" in
      *"/.tfenv/"*)
        if has_cmd tfenv; then
          echo "Terraform in PATH is still tfenv-managed and below required version; selecting ${REQUIRED_TERRAFORM_VERSION} via tfenv..."
          tfenv install "${REQUIRED_TERRAFORM_VERSION}"
          tfenv use "${REQUIRED_TERRAFORM_VERSION}"
        fi
        ;;
    esac
  fi

  if ! has_cmd terraform || ! terraform_matches_required_version; then
    resolved_bin="$(tool_cmd_path "terraform")"
    resolved_version="$(terraform_version)"
    echo "Terraform installation failed: ${resolved_bin:-terraform not found} reports version ${resolved_version:-unknown}, expected ${REQUIRED_TERRAFORM_VERSION}." >&2
    if [ -n "$resolved_bin" ]; then
      echo "All terraform binaries in PATH:" >&2
      which -a terraform >&2 || true
    fi
    exit 1
  fi

  echo "Terraform $(terraform_version) installed at $(tool_cmd_path "terraform")."
}

install_postgres_linux() {
  if [ "$OS" != "linux" ]; then
    return
  fi

  if has_cmd psql && has_cmd createdb; then
    echo "PostgreSQL client tools are already installed."
  else
    echo "Installing PostgreSQL server/client..."
    sudo apt-get update -qq
    sudo apt-get install -y postgresql postgresql-client
    echo "PostgreSQL packages installed."
  fi

  if has_cmd systemctl; then
    if output=$(sudo systemctl enable --now postgresql 2>&1); then
      echo "PostgreSQL service enabled and started."
    else
      echo "Warning: Could not start postgresql via systemctl." >&2
      echo "Try: sudo pg_ctlcluster <version> <cluster> start" >&2
      echo "Error details: ${output}" >&2
    fi
  elif has_cmd service; then
    if output=$(sudo service postgresql start 2>&1); then
      echo "PostgreSQL service started."
    else
      echo "Warning: Could not start postgresql via service." >&2
      echo "Error details: ${output}" >&2
    fi
  fi
}
