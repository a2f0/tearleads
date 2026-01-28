#!/bin/sh
set -eu

SCRIPT_PATH=$0
case $SCRIPT_PATH in
  */*) ;;
  *) SCRIPT_PATH=$(command -v -- "$SCRIPT_PATH" || true) ;;
esac
SCRIPT_DIR=$(cd -- "$(dirname -- "${SCRIPT_PATH:-$0}")" && pwd -P)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd -P)

KEY_PATH="$REPO_ROOT/.secrets/tuxedoDeploy.key"
PUB_PATH="$KEY_PATH.pub"
KEY_TITLE="tuxedo deploy key"

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

mkdir -p "$REPO_ROOT/.secrets"

if [ ! -f "$KEY_PATH" ]; then
  ssh-keygen -t ed25519 -C "$KEY_TITLE" -f "$KEY_PATH" -N ""
fi

if [ ! -f "$PUB_PATH" ]; then
  echo "Missing public key at $PUB_PATH" >&2
  exit 1
fi

REPO="$REPO" KEY_TITLE="$KEY_TITLE" PUB_PATH="$PUB_PATH" python - <<'PY'
import json
import os
import subprocess
import sys

repo = os.environ["REPO"]
title = os.environ["KEY_TITLE"]
pub_path = os.environ["PUB_PATH"]

pub_raw = open(pub_path, "r", encoding="utf-8").read().strip()
pub_parts = pub_raw.split()
pub_key = " ".join(pub_parts[:2]) if len(pub_parts) >= 2 else pub_raw

env = dict(os.environ)
env["GH_PAGER"] = "cat"
env["GH_NO_UPDATE_NOTIFIER"] = "1"

cmd = ["gh", "api", "--paginate", f"/repos/{repo}/keys"]
existing = json.loads(subprocess.check_output(cmd, text=True, env=env))

for item in existing:
  if item.get("title") == title:
    if item.get("key") == pub_key:
      print("Deploy key already exists and matches public key.")
      sys.exit(0)
    key_id = item.get("id")
    if not key_id:
      print("Deploy key title exists but id is missing; cannot update.")
      sys.exit(1)
    subprocess.run(
      ["gh", "api", "-X", "DELETE", f"/repos/{repo}/keys/{key_id}"],
      check=True,
      env=env,
      stdout=subprocess.DEVNULL,
    )
    break

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
