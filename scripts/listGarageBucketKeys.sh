#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/listGarageBucketKeys.sh <staging|prod> [prefix]

Lists object keys in the Garage-backed blob bucket for the selected server.
The optional prefix limits the S3 ListObjectsV2 request.

Set GARAGE_SSH_TARGET=user@host to bypass Terraform/Hetzner SSH resolution.
EOF
}

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ERROR: $command_name is required." >&2
    exit 1
  fi
}

shell_quote() {
  local value=${1//\'/\'\\\'\'}
  printf "'%s'" "$value"
}

terraform_output_raw() {
  local stack_dir="$1"
  local output_name="$2"
  local output_value

  output_value="$(
    terraform -chdir="$stack_dir" output -no-color -raw "$output_name" 2>/dev/null ||
      true
  )"

  if [[ -z "$output_value" ||
    "$output_value" == *$'\n'* ||
    "$output_value" == *$'\033'* ||
    "$output_value" == *Warning:* ||
    "$output_value" == *Error:* ]]; then
    return 1
  fi

  printf "%s" "$output_value"
}

hcloud_server_ip_for_tier() {
  local tier="$1"
  local server_name response

  if [[ -z "${TF_VAR_hcloud_token:-}" || -z "${TF_VAR_domain:-}" ]]; then
    return 1
  fi

  if ! command -v curl >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    return 1
  fi

  server_name="$tier-${TF_VAR_domain}"
  response="$(
    curl -fsS -G \
      -H "Authorization: Bearer ${TF_VAR_hcloud_token}" \
      --data-urlencode "name=$server_name" \
      "https://api.hetzner.cloud/v1/servers" 2>/dev/null ||
      true
  )"

  if [[ -z "$response" ]]; then
    return 1
  fi

  local server_ip
  server_ip="$(jq -r '.servers[0].public_net.ipv4.ip // empty' <<<"$response")"
  if [[ -z "$server_ip" ]]; then
    echo "WARNING: no Hetzner server named $server_name was found." >&2
    return 1
  fi

  printf "%s" "$server_ip"
}

resolve_garage_ssh_target() {
  local stack_dir="$1"
  local tier="$2"
  local username hostname server_ip ssh_target

  if [[ -n "${GARAGE_SSH_TARGET:-}" ]]; then
    wait_for_ssh_ready "$GARAGE_SSH_TARGET" >&2 || return 1
    echo "$GARAGE_SSH_TARGET"
    return 0
  fi

  username="$(terraform_output_raw "$stack_dir" server_username || true)"
  username="${username:-${TF_VAR_server_username:-}}"
  hostname="$(terraform_output_raw "$stack_dir" ssh_hostname || true)"
  hostname="${hostname:-$tier}"

  if [[ -z "$username" ]]; then
    echo "ERROR: Could not resolve server username from Terraform outputs or TF_VAR_server_username." >&2
    return 1
  fi

  if [[ -n "$hostname" ]]; then
    ssh_target="$username@$hostname"
    if wait_for_ssh_ready "$ssh_target" 3 5 10 >&2; then
      echo "$ssh_target"
      return 0
    fi
    echo "WARNING: $ssh_target is not reachable; trying the public server IP." >&2
  fi

  server_ip="$(terraform_output_raw "$stack_dir" server_ip || true)"
  server_ip="${server_ip:-$(hcloud_server_ip_for_tier "$tier" || true)}"
  if [[ -n "$server_ip" ]]; then
    ssh_target="$username@$server_ip"
    wait_for_ssh_ready "$ssh_target" >&2 || return 1
    echo "$ssh_target"
    return 0
  fi

  echo "ERROR: Could not resolve a reachable SSH target for $tier." >&2
  return 1
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    return 0
  fi

  local tier="${1:-}"
  local prefix="${2:-}"

  if [[ "$tier" != "staging" && "$tier" != "prod" ]]; then
    usage >&2
    exit 1
  fi

  if [[ $# -gt 2 ]]; then
    usage >&2
    exit 1
  fi

  require_command git
  require_command ssh
  require_command terraform

  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"

  # shellcheck source=../terraform/scripts/common.sh
  # shellcheck disable=SC1091
  . "$repo_root/terraform/scripts/common.sh"

  load_secrets_env "$tier"
  validate_aws_env

  local stack_dir backend_config ssh_target remote_prefix_arg
  stack_dir="$repo_root/terraform/stacks/$tier/server"
  backend_config="$(get_backend_config)"

  terraform -chdir="$stack_dir" init -input=false -no-color -backend-config="$backend_config" >&2
  ssh_target="$(resolve_garage_ssh_target "$stack_dir" "$tier")"
  remote_prefix_arg="$(shell_quote "$prefix")"

  echo "Listing Garage bucket keys for $tier via $ssh_target..." >&2

  # shellcheck disable=SC2029
  ssh "$ssh_target" "sudo -n python3 - --prefix $remote_prefix_arg" <<'PY'
import argparse
import datetime as dt
import hashlib
import hmac
import shlex
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

try:
    import tomllib
except ModuleNotFoundError:
    tomllib = None


EMPTY_PAYLOAD_SHA256 = hashlib.sha256(b"").hexdigest()


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", default="")
    return parser.parse_args()


def parse_env_file(path):
    env = {}
    try:
        with open(path, encoding="utf-8") as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[len("export ") :].lstrip()
                key, separator, value = line.partition("=")
                if not separator:
                    continue
                key = key.strip()
                value = value.strip()
                if not key:
                    continue
                try:
                    parsed = shlex.split(value, comments=False, posix=True)
                    env[key] = parsed[0] if parsed else ""
                except ValueError:
                    env[key] = value.strip("'\"")
    except FileNotFoundError:
        pass
    return env


def garage_region_from_config(path="/etc/garage.toml"):
    try:
        with open(path, "rb") as config_file:
            if tomllib is not None:
                config = tomllib.load(config_file)
                return config.get("s3_api", {}).get("s3_region")
            text = config_file.read().decode("utf-8")
    except FileNotFoundError:
        return None

    in_s3_api = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line == "[s3_api]":
            in_s3_api = True
            continue
        if in_s3_api and line.startswith("["):
            return None
        key, separator, value = line.partition("=")
        if in_s3_api and separator and key.strip() == "s3_region":
            return value.strip().strip("'\"")

    return None


def require_value(value, message):
    if value:
        return value
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


def child_text(parent, name):
    for child in parent:
        if local_name(child.tag) == name:
            return child.text or ""
    return ""


def signing_key(secret_key, date_stamp, region):
    date_key = hmac.new(
        ("AWS4" + secret_key).encode("utf-8"),
        date_stamp.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    region_key = hmac.new(date_key, region.encode("utf-8"), hashlib.sha256).digest()
    service_key = hmac.new(region_key, b"s3", hashlib.sha256).digest()
    return hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()


def canonical_query_string(query_items):
    return urllib.parse.urlencode(
        sorted(query_items),
        quote_via=urllib.parse.quote,
        safe="-_.~",
    )


def signed_get(endpoint, bucket, query_items, access_key, secret_key, region):
    parsed_endpoint = urllib.parse.urlparse(endpoint)
    host = require_value(parsed_endpoint.netloc, "Garage S3 endpoint has no host")
    endpoint_path = parsed_endpoint.path.rstrip("/")
    canonical_uri = f"{endpoint_path}/{urllib.parse.quote(bucket, safe='')}"
    if not canonical_uri.startswith("/"):
        canonical_uri = "/" + canonical_uri

    query_string = canonical_query_string(query_items)
    request_url = urllib.parse.urlunparse(
        (
            parsed_endpoint.scheme,
            parsed_endpoint.netloc,
            canonical_uri,
            "",
            query_string,
            "",
        )
    )

    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    canonical_headers = (
        f"host:{host}\n"
        f"x-amz-content-sha256:{EMPTY_PAYLOAD_SHA256}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(
        [
            "GET",
            canonical_uri,
            query_string,
            canonical_headers,
            signed_headers,
            EMPTY_PAYLOAD_SHA256,
        ]
    )
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(
        signing_key(secret_key, date_stamp, region),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    authorization = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    request = urllib.request.Request(
        request_url,
        headers={
            "Authorization": authorization,
            "Host": host,
            "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
            "x-amz-date": amz_date,
        },
        method="GET",
    )

    try:
        with urllib.request.urlopen(request) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        print(f"ERROR: Garage S3 list failed with HTTP {error.code}.", file=sys.stderr)
        if body:
            print(body, file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as error:
        print(f"ERROR: Could not connect to Garage S3 endpoint: {error.reason}", file=sys.stderr)
        sys.exit(1)


def main():
    args = parse_args()
    garage_env = parse_env_file("/etc/garage.env")
    api_env = parse_env_file("/etc/tearleads/api.env")
    env = {**api_env, **garage_env}

    access_key = require_value(
        env.get("GARAGE_DEFAULT_ACCESS_KEY")
        or env.get("BLOB_OBJECT_STORE_S3_ACCESS_KEY_ID")
        or env.get("VFS_BLOB_S3_ACCESS_KEY_ID"),
        "could not find a Garage S3 access key on the server",
    )
    secret_key = require_value(
        env.get("GARAGE_DEFAULT_SECRET_KEY")
        or env.get("BLOB_OBJECT_STORE_S3_SECRET_ACCESS_KEY")
        or env.get("VFS_BLOB_S3_SECRET_ACCESS_KEY"),
        "could not find a Garage S3 secret key on the server",
    )
    bucket = require_value(
        env.get("GARAGE_DEFAULT_BUCKET")
        or env.get("BLOB_OBJECT_STORE_S3_BUCKET")
        or env.get("VFS_BLOB_S3_BUCKET"),
        "could not find a Garage S3 bucket name on the server",
    )
    endpoint = (
        env.get("BLOB_OBJECT_STORE_S3_ENDPOINT")
        or env.get("VFS_BLOB_S3_ENDPOINT")
        or "http://127.0.0.1:3900"
    )
    region = (
        env.get("BLOB_OBJECT_STORE_S3_REGION")
        or env.get("VFS_BLOB_S3_REGION")
        or garage_region_from_config()
        or "garage"
    )

    token = None
    while True:
        query_items = [("list-type", "2")]
        if args.prefix:
            query_items.append(("prefix", args.prefix))
        if token:
            query_items.append(("continuation-token", token))

        payload = signed_get(endpoint, bucket, query_items, access_key, secret_key, region)
        root = ET.fromstring(payload)

        for child in root:
            if local_name(child.tag) != "Contents":
                continue
            key = child_text(child, "Key")
            if key:
                print(key)

        if child_text(root, "IsTruncated").lower() != "true":
            break

        token = child_text(root, "NextContinuationToken")
        if not token:
            print(
                "ERROR: Garage S3 response was truncated without a continuation token.",
                file=sys.stderr,
            )
            sys.exit(1)


if __name__ == "__main__":
    main()
PY
}

main "$@"
