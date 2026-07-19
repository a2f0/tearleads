#!/usr/bin/env sh

set -eu

fail() {
  echo "Error: $*" >&2
  exit 1
}

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) ||
  fail "Protocol model checks must run inside a Git repository."
REGISTRY_PATH=formal/protocol-models.txt

cd "$REPO_ROOT"

[ -f "$REGISTRY_PATH" ] || fail "$REGISTRY_PATH does not exist."

CHECK_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/tearleads-tlc.XXXXXX")
trap 'rm -rf "$CHECK_ROOT"' EXIT
trap 'exit 1' HUP INT TERM

REGISTERED_MODELS=$CHECK_ROOT/registered-models.txt
SORTED_MODELS=$CHECK_ROOT/sorted-models.txt
RAW_REGISTERED_CONFIGS=$CHECK_ROOT/raw-registered-configs.txt
REGISTERED_CONFIGS=$CHECK_ROOT/registered-configs.txt
DISCOVERED_CONFIGS_UNSORTED=$CHECK_ROOT/discovered-configs-unsorted.txt
DISCOVERED_CONFIGS=$CHECK_ROOT/discovered-configs.txt
DUPLICATE_PAIRS=$CHECK_ROOT/duplicate-pairs.txt
DUPLICATE_CONFIGS=$CHECK_ROOT/duplicate-configs.txt
UNREGISTERED_CONFIGS=$CHECK_ROOT/unregistered-configs.txt
RAW_REGISTERED_MODEL_PATHS=$CHECK_ROOT/raw-registered-model-paths.txt
REGISTERED_MODEL_PATHS=$CHECK_ROOT/registered-model-paths.txt
DISCOVERED_MODELS_UNSORTED=$CHECK_ROOT/discovered-models-unsorted.txt
DISCOVERED_MODELS=$CHECK_ROOT/discovered-models.txt
UNREGISTERED_MODELS=$CHECK_ROOT/unregistered-models.txt

line_number=0
while IFS= read -r registry_line || [ -n "$registry_line" ]; do
  line_number=$((line_number + 1))

  case "$registry_line" in
    ''|'#'*) continue ;;
  esac

  case "$registry_line" in
    *[[:space:]]*)
      fail "$REGISTRY_PATH:$line_number contains whitespace; use model|config."
      ;;
  esac

  model_path=${registry_line%%|*}
  config_path=${registry_line#*|}
  [ "$config_path" != "$registry_line" ] ||
    fail "$REGISTRY_PATH:$line_number must contain one model|config pair."
  case "$config_path" in
    *'|'*)
      fail "$REGISTRY_PATH:$line_number must contain exactly one '|'."
      ;;
  esac

  case "$model_path" in
    formal/*.tla) ;;
    *) fail "$REGISTRY_PATH:$line_number model must be a .tla path under formal/." ;;
  esac
  case "$config_path" in
    formal/*.cfg) ;;
    *) fail "$REGISTRY_PATH:$line_number config must be a .cfg path under formal/." ;;
  esac

  case "/$model_path/$config_path/" in
    *'/../'*|*'/./'*|*'//'*)
      fail "$REGISTRY_PATH:$line_number contains a non-normalized path."
      ;;
  esac
  case "$model_path$config_path" in
    *\\*) fail "$REGISTRY_PATH:$line_number must use forward slashes." ;;
  esac

  [ ! -L "$model_path" ] || fail "$model_path must not be a symbolic link."
  [ ! -L "$config_path" ] || fail "$config_path must not be a symbolic link."
  [ -f "$model_path" ] || fail "$model_path does not exist."
  [ -f "$config_path" ] || fail "$config_path does not exist."
  printf '%s|%s\n' "$model_path" "$config_path" >>"$REGISTERED_MODELS"
done <"$REGISTRY_PATH"

[ -s "$REGISTERED_MODELS" ] || fail "$REGISTRY_PATH does not register any models."

LC_ALL=C sort "$REGISTERED_MODELS" >"$SORTED_MODELS" ||
  fail "could not sort $REGISTRY_PATH."
uniq -d "$SORTED_MODELS" >"$DUPLICATE_PAIRS" ||
  fail "could not inspect $REGISTRY_PATH for duplicate pairs."
duplicate_pair=$(sed -n '1p' "$DUPLICATE_PAIRS")
[ -z "$duplicate_pair" ] || fail "$REGISTRY_PATH registers $duplicate_pair more than once."

cut -d '|' -f 2 "$REGISTERED_MODELS" >"$RAW_REGISTERED_CONFIGS" ||
  fail "could not read configuration paths from $REGISTRY_PATH."
LC_ALL=C sort "$RAW_REGISTERED_CONFIGS" >"$REGISTERED_CONFIGS" ||
  fail "could not sort registered configuration paths."
uniq -d "$REGISTERED_CONFIGS" >"$DUPLICATE_CONFIGS" ||
  fail "could not inspect $REGISTRY_PATH for duplicate configurations."
duplicate_config=$(sed -n '1p' "$DUPLICATE_CONFIGS")
[ -z "$duplicate_config" ] ||
  fail "$REGISTRY_PATH assigns $duplicate_config to more than one model."

find formal -type f -name '*.cfg' -print >"$DISCOVERED_CONFIGS_UNSORTED" ||
  fail "could not discover protocol model configurations under formal/."
LC_ALL=C sort "$DISCOVERED_CONFIGS_UNSORTED" >"$DISCOVERED_CONFIGS" ||
  fail "could not sort discovered protocol model configurations."
LC_ALL=C comm -23 "$DISCOVERED_CONFIGS" "$REGISTERED_CONFIGS" >"$UNREGISTERED_CONFIGS" ||
  fail "could not compare discovered and registered protocol model configurations."
unregistered_config=$(sed -n '1p' "$UNREGISTERED_CONFIGS")
[ -z "$unregistered_config" ] ||
  fail "$unregistered_config is not registered in $REGISTRY_PATH."

# Reconcile .tla files too: with only the .cfg reconciliation above, deleting
# a model's configuration (and its registry row) leaves the model on disk but
# silently removes it from checking.
cut -d '|' -f 1 "$REGISTERED_MODELS" >"$RAW_REGISTERED_MODEL_PATHS" ||
  fail "could not read model paths from $REGISTRY_PATH."
LC_ALL=C sort -u "$RAW_REGISTERED_MODEL_PATHS" >"$REGISTERED_MODEL_PATHS" ||
  fail "could not sort registered model paths."
find formal -type f -name '*.tla' -print >"$DISCOVERED_MODELS_UNSORTED" ||
  fail "could not discover protocol models under formal/."
LC_ALL=C sort "$DISCOVERED_MODELS_UNSORTED" >"$DISCOVERED_MODELS" ||
  fail "could not sort discovered protocol models."
LC_ALL=C comm -23 "$DISCOVERED_MODELS" "$REGISTERED_MODEL_PATHS" >"$UNREGISTERED_MODELS" ||
  fail "could not compare discovered and registered protocol models."
unregistered_model=$(sed -n '1p' "$UNREGISTERED_MODELS")
[ -z "$unregistered_model" ] ||
  fail "$unregistered_model is not registered in $REGISTRY_PATH; an unregistered model is never checked."

mv "$SORTED_MODELS" "$REGISTERED_MODELS" ||
  fail "could not finalize the protocol model registry."

command -v mise >/dev/null 2>&1 ||
  fail "mise is unavailable. Install mise, then run 'mise install github:tlaplus/tlaplus'."

JAVA_BIN=$(mise which java 2>/dev/null) ||
  fail "Java is unavailable. Run 'mise install java'."
[ -x "$JAVA_BIN" ] || fail "$JAVA_BIN is not executable."

TLA_TOOLS_ROOT=$(mise where github:tlaplus/tlaplus 2>/dev/null) ||
  fail "TLA+ tools are unavailable. Run 'mise install github:tlaplus/tlaplus'."
TLA_TOOLS_JAR=$TLA_TOOLS_ROOT/tla2tools.jar
[ -f "$TLA_TOOLS_JAR" ] || fail "$TLA_TOOLS_JAR does not exist."

# TLC gates the protocol contract, but the GitHub release publishes no digest
# and mise records no checksum for this asset, so the jar bytes are pinned
# here. Update the pin only for an intentional TLA+ tools upgrade.
TLA_TOOLS_JAR_SHA256=${TLA_TOOLS_JAR_SHA256:-936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88}
if command -v sha256sum >/dev/null 2>&1; then
  tla_tools_jar_sha256=$(sha256sum "$TLA_TOOLS_JAR" | cut -d ' ' -f 1)
else
  tla_tools_jar_sha256=$(shasum -a 256 "$TLA_TOOLS_JAR" | cut -d ' ' -f 1)
fi
[ "$tla_tools_jar_sha256" = "$TLA_TOOLS_JAR_SHA256" ] ||
  fail "$TLA_TOOLS_JAR sha256 $tla_tools_jar_sha256 does not match the pinned $TLA_TOOLS_JAR_SHA256."

model_count=0
while IFS='|' read -r model_path config_path; do
  model_count=$((model_count + 1))
  model_state_path=$CHECK_ROOT/model-$model_count
  mkdir "$model_state_path"

  echo "Checking $model_path with $config_path..."
  if "$JAVA_BIN" -XX:+UseParallelGC -jar "$TLA_TOOLS_JAR" \
    -workers 1 \
    -metadir "$model_state_path" \
    -config "$config_path" \
    "$model_path"; then
    :
  else
    model_status=$?
    echo "Error: TLC failed for $model_path with $config_path." >&2
    exit "$model_status"
  fi
done <"$REGISTERED_MODELS"

echo "Checked $model_count protocol model configuration(s)."
