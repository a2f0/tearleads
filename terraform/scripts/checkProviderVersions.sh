#!/bin/bash
# Check for available provider major version upgrades across all stacks and modules.
#
# Parses required_providers blocks from versions.tf files, queries the
# Terraform registry for the latest stable version, and reports when a
# newer major version exists outside the current constraint.
#
# No credentials required — this is a read-only registry check.
#
# Environment toggles:
#   ONLY_TIER=<tier>   Only check stacks in a specific tier (dev|staging|prod|shared)
#   INCLUDE_MODULES=1  Also check module versions.tf files (default: stacks only)
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TF_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REGISTRY_URL="https://registry.terraform.io/v1/providers"

# File-based cache for registry lookups (cleaned up on exit).
CACHE_DIR="$(mktemp -d)"
trap 'rm -rf "$CACHE_DIR"' EXIT

log() {
  echo "checkProviderVersions: $*"
}

# Extract the major version from a semver string (e.g. "5.100.0" -> "5").
major_version() {
  echo "${1%%.*}"
}

# Extract the constrained major version from a version constraint string.
# Supports ~> X.Y, >= X.Y, ~> X.Y.Z patterns.
constraint_major() {
  local constraint="$1"
  local version
  version="${constraint##* }"
  major_version "$version"
}

# Query the Terraform registry for the latest stable version of a provider.
# Skips pre-release versions (alpha, beta, rc).
query_latest_stable() {
  local source="$1"
  local namespace="${source%%/*}"
  local type="${source##*/}"
  local cache_file="$CACHE_DIR/${namespace}__${type}"

  # Check cache first
  if [ -f "$cache_file" ]; then
    cat "$cache_file"
    return
  fi

  local latest
  latest="$(curl -sf "$REGISTRY_URL/$namespace/$type" | \
    python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    v = d.get('version', '')
    if any(tag in v for tag in ['alpha', 'beta', 'rc', 'dev']):
        versions = d.get('versions', [])
        for ver in reversed(versions):
            if not any(tag in ver for tag in ['alpha', 'beta', 'rc', 'dev']):
                print(ver)
                sys.exit(0)
    print(v)
except:
    pass
" 2>/dev/null || true)"

  if [ -n "$latest" ]; then
    echo "$latest" > "$cache_file"
  fi
  echo "$latest"
}

# Parse a versions.tf file and extract provider source + version constraint pairs.
# Output format: source=constraint (one per line)
parse_providers() {
  local versions_tf="$1"
  python3 -c "
import re, sys

content = open(sys.argv[1]).read()

# Find required_providers block using brace counting
start = content.find('required_providers')
if start == -1:
    sys.exit(0)
brace_start = content.index('{', start)
depth = 0
end = brace_start
for i in range(brace_start, len(content)):
    if content[i] == '{':
        depth += 1
    elif content[i] == '}':
        depth -= 1
        if depth == 0:
            end = i
            break
block = content[brace_start+1:end]

# Extract source and version from each provider entry
sources = re.findall(r'source\s*=\s*\"([^\"]+)\"', block)
versions = re.findall(r'version\s*=\s*\"([^\"]+)\"', block)

for source, version in zip(sources, versions):
    first_constraint = version.split(',')[0].strip()
    print(f'{source}={first_constraint}')
" "$versions_tf" 2>/dev/null || true
}

# Collect all versions.tf files to check.
collect_versions_files() {
  for vf in "$TF_ROOT"/stacks/*/*/versions.tf; do
    [ -f "$vf" ] || continue

    if [ -n "${ONLY_TIER:-}" ]; then
      local rel="${vf#"$TF_ROOT"/stacks/}"
      local tier="${rel%%/*}"
      [ "$tier" = "$ONLY_TIER" ] || continue
    fi

    echo "$vf"
  done

  if [ -z "${ONLY_TIER:-}" ] && [ -f "$TF_ROOT/bootstrap/versions.tf" ]; then
    echo "$TF_ROOT/bootstrap/versions.tf"
  fi

  if [ "${INCLUDE_MODULES:-0}" -eq 1 ]; then
    for vf in "$TF_ROOT"/modules/*/versions.tf; do
      [ -f "$vf" ] || continue
      echo "$vf"
    done
  fi
}

# --- Main ---

if ! command -v curl >/dev/null 2>&1; then
  echo "checkProviderVersions: curl is required." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "checkProviderVersions: python3 is required." >&2
  exit 1
fi

log "scanning versions.tf files..."
echo ""

# Collect unique providers: write "source=constraint" lines to a dedupe file.
PROVIDERS_FILE="$CACHE_DIR/providers.txt"
: > "$PROVIDERS_FILE"

while IFS= read -r vf; do
  [ -z "$vf" ] && continue
  while IFS= read -r entry; do
    [ -z "$entry" ] && continue
    source="${entry%%=*}"
    # Only keep the first constraint seen for each provider
    if ! grep -q "^${source}=" "$PROVIDERS_FILE" 2>/dev/null; then
      echo "$entry" >> "$PROVIDERS_FILE"
    fi
  done <<< "$(parse_providers "$vf")"
done <<< "$(collect_versions_files)"

# Query registry for each unique provider and compare.
printf "%-30s %-15s %-15s %s\n" "PROVIDER" "CONSTRAINT" "LATEST" "STATUS"
printf "%-30s %-15s %-15s %s\n" "--------" "----------" "------" "------"

sort "$PROVIDERS_FILE" | while IFS= read -r line; do
  [ -z "$line" ] && continue
  source="${line%%=*}"
  constraint="${line#*=}"
  latest="$(query_latest_stable "$source")"

  if [ -z "$latest" ]; then
    printf "%-30s %-15s %-15s %s\n" "$source" "$constraint" "?" "registry error"
    continue
  fi

  constraint_maj="$(constraint_major "$constraint")"
  latest_maj="$(major_version "$latest")"

  if [ "$latest_maj" -gt "$constraint_maj" ] 2>/dev/null; then
    printf "%-30s %-15s %-15s %s\n" "$source" "$constraint" "$latest" "MAJOR UPGRADE AVAILABLE"
    # Signal via file since we're in a pipeline subshell
    touch "$CACHE_DIR/has_gap"
  else
    printf "%-30s %-15s %-15s %s\n" "$source" "$constraint" "$latest" "current"
  fi
done

echo ""
if [ -f "$CACHE_DIR/has_gap" ]; then
  log "major version upgrades are available. Update version constraints in versions.tf to adopt."
  exit 2
else
  log "all providers are on the latest major version."
fi
