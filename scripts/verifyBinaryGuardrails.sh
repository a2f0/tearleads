#!/usr/bin/env bash
set -euo pipefail

# This script verifies that binary file guardrails are properly configured.
# It runs in CI to prevent agents from accidentally removing these protections.

errors=()

# Check 1: Binary check script exists
if [ ! -f "scripts/checkBinaryFiles.sh" ]; then
  errors+=("Missing scripts/checkBinaryFiles.sh")
elif [ ! -x "scripts/checkBinaryFiles.sh" ]; then
  errors+=("scripts/checkBinaryFiles.sh is not executable")
fi

# Check 2: Pre-commit hook exists and calls binary check
if [ ! -f ".husky/pre-commit" ]; then
  errors+=("Missing .husky/pre-commit hook")
elif ! grep -q "checkBinaryFiles.sh --staged" ".husky/pre-commit"; then
  errors+=(".husky/pre-commit does not call checkBinaryFiles.sh --staged")
fi

# Check 3: Pre-push hook calls binary check
if [ ! -f ".husky/pre-push" ]; then
  errors+=("Missing .husky/pre-push hook")
elif ! grep -q "checkBinaryFiles.sh --from-upstream" ".husky/pre-push"; then
  errors+=(".husky/pre-push does not call checkBinaryFiles.sh --from-upstream")
fi

# Check 4: CI workflow includes binary check
if [ ! -f ".github/workflows/build.yml" ]; then
  errors+=("Missing .github/workflows/build.yml")
elif ! grep -q "checkBinaryFiles.sh" ".github/workflows/build.yml"; then
  errors+=(".github/workflows/build.yml does not include binary file check")
fi

# Check 5: Agent instructions include binary policy
for file in CLAUDE.md AGENTS.md; do
  if [ -f "$file" ]; then
    if ! grep -q "Binary Files Policy" "$file"; then
      errors+=("$file missing Binary Files Policy section")
    fi
  fi
done

if [ "${#errors[@]}" -gt 0 ]; then
  echo "Error: Binary file guardrails are misconfigured:" >&2
  printf '  - %s\n' "${errors[@]}" >&2
  echo "" >&2
  echo "These guardrails prevent binary files from being committed." >&2
  echo "Do not remove or weaken them without explicit approval." >&2
  exit 1
fi

echo "Binary guardrails verified successfully."
