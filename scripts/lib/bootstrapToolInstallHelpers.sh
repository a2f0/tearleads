vault_cmd_path() {
  command -v vault 2>/dev/null || true
}

darwin_release_arch() {
  case "$(uname -m)" in
    arm64 | aarch64) echo "arm64" ;;
    x86_64 | amd64) echo "amd64" ;;
    *)
      echo "Unsupported macOS architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

extract_zip_archive() {
  zip_path="$1"
  target_dir="$2"

  if has_cmd bsdtar; then
    bsdtar -xf "$zip_path" -C "$target_dir"
  elif has_cmd unzip; then
    unzip -oq "$zip_path" -d "$target_dir"
  else
    echo "Cannot extract archive: missing bsdtar and unzip." >&2
    return 1
  fi
}

install_binary_in_path() {
  source_path="$1"
  target_path="$2"

  if [ -w "$(dirname "$target_path")" ]; then
    install -m 0755 "$source_path" "$target_path"
  else
    sudo install -m 0755 "$source_path" "$target_path"
  fi
}

install_darwin_hashicorp_zip() {
  tool_name="$1"
  tool_version="$2"
  tool_arch="$(darwin_release_arch)"
  tool_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/${tool_name}-bootstrap.XXXXXX")"
  tool_zip_path="${tool_tmp_dir}/${tool_name}.zip"
  tool_download_url="https://releases.hashicorp.com/${tool_name}/${tool_version}/${tool_name}_${tool_version}_darwin_${tool_arch}.zip"

  echo "Installing ${tool_name} ${tool_version} from HashiCorp releases." >&2
  curl -fsSL "$tool_download_url" -o "$tool_zip_path"
  extract_zip_archive "$tool_zip_path" "$tool_tmp_dir"
  echo "$tool_tmp_dir"
}
