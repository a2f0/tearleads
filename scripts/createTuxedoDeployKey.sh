#!/bin/sh
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

KEY_PATH="$REPO_ROOT/.secrets/tuxedoGithubDeployKey"
PUB_PATH="$KEY_PATH.pub"
KEY_TITLE="tuxedoGithubDeployKey"
OLD_KEY_TITLE="tuxedo deploy key"
OLD_KEY_PATH="$REPO_ROOT/.secrets/tuxedoDeploy.key"
OLD_PUB_PATH="$OLD_KEY_PATH.pub"

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

mkdir -p "$REPO_ROOT/.secrets"

if [ ! -f "$KEY_PATH" ] && [ -f "$OLD_KEY_PATH" ]; then
  mv "$OLD_KEY_PATH" "$KEY_PATH"
fi

if [ ! -f "$PUB_PATH" ] && [ -f "$OLD_PUB_PATH" ]; then
  mv "$OLD_PUB_PATH" "$PUB_PATH"
fi

if [ ! -f "$KEY_PATH" ]; then
  ssh-keygen -t ed25519 -C "$KEY_TITLE" -f "$KEY_PATH" -N ""
fi

if [ ! -f "$PUB_PATH" ]; then
  echo "Missing public key at $PUB_PATH" >&2
  exit 1
fi

REPO="$REPO" KEY_TITLE="$KEY_TITLE" OLD_KEY_TITLE="$OLD_KEY_TITLE" PUB_PATH="$PUB_PATH" python - <<'PY'
import json
import os
import subprocess
import sys

repo = os.environ["REPO"]
title = os.environ["KEY_TITLE"]
old_title = os.environ["OLD_KEY_TITLE"]
pub_path = os.environ["PUB_PATH"]

pub_raw = open(pub_path, "r", encoding="utf-8").read().strip()
pub_parts = pub_raw.split()
pub_key = " ".join(pub_parts[:2]) if len(pub_parts) >= 2 else pub_raw

env = dict(os.environ)
env["GH_PAGER"] = "cat"
env["GH_NO_UPDATE_NOTIFIER"] = "1"

cmd = ["gh", "api", "--paginate", f"/repos/{repo}/keys"]
existing = json.loads(subprocess.check_output(cmd, text=True, env=env))

ids_to_delete = []
found_matching_key = False

for item in existing:
  item_id = item.get("id")
  if not item_id:
    continue
  item_title = item.get("title")
  if item_title == old_title:
    ids_to_delete.append(item_id)
    continue
  if item_title == title:
    if item.get("key") == pub_key:
      found_matching_key = True
    else:
      ids_to_delete.append(item_id)

for key_id in ids_to_delete:
  subprocess.run(
    ["gh", "api", "-X", "DELETE", f"/repos/{repo}/keys/{key_id}"],
    check=True,
    env=env,
    stdout=subprocess.DEVNULL,
  )

if found_matching_key:
  print("Deploy key already exists and matches public key.")
  sys.exit(0)

payload = json.dumps({"title": title, "key": pub_key, "read_only": False})
create_cmd = ["gh", "api", "-X", "POST", f"/repos/{repo}/keys", "--input", "-"]
subprocess.run(
  create_cmd,
  input=payload,
  text=True,
  check=True,
  env=env,
  stdout=subprocess.DEVNULL,
)
print("Deploy key created.")
PY
