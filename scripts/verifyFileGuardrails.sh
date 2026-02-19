#!/usr/bin/env bash
set -euo pipefail

# This script verifies that file guardrails (binary and JS) are properly configured.
# It runs in CI to prevent agents from accidentally removing these protections.

errors=()

# Check 1: Binary check script exists
if [ ! -f "scripts/checkBinaryFiles.sh" ]; then
  errors+=("Missing scripts/checkBinaryFiles.sh")
elif [ ! -x "scripts/checkBinaryFiles.sh" ]; then
  errors+=("scripts/checkBinaryFiles.sh is not executable")
fi

# Check 2: JavaScript check script exists
if [ ! -f "scripts/preen/checkJs.sh" ]; then
  errors+=("Missing scripts/preen/checkJs.sh")
elif [ ! -x "scripts/preen/checkJs.sh" ]; then
  errors+=("scripts/preen/checkJs.sh is not executable")
fi

# Check 3: Client boundary check script exists
if [ ! -f "scripts/preen/checkClientBoundary.sh" ]; then
  errors+=("Missing scripts/preen/checkClientBoundary.sh")
elif [ ! -x "scripts/preen/checkClientBoundary.sh" ]; then
  errors+=("scripts/preen/checkClientBoundary.sh is not executable")
fi

# Check 4: Pre-commit hook exists and calls binary check
if [ ! -f ".husky/pre-commit" ]; then
  errors+=("Missing .husky/pre-commit hook")
elif ! grep -q "checkBinaryFiles.sh --staged" ".husky/pre-commit"; then
  errors+=(".husky/pre-commit does not call checkBinaryFiles.sh --staged")
fi

# Check 5: Pre-push hook calls binary, JS, and client boundary checks
if [ ! -f ".husky/pre-push" ]; then
  errors+=("Missing .husky/pre-push hook")
else
  if ! grep -q "checkBinaryFiles.sh --from-upstream" ".husky/pre-push"; then
    errors+=(".husky/pre-push does not call checkBinaryFiles.sh --from-upstream")
  fi
  if ! grep -q "scripts/preen/checkJs.sh --from-upstream" ".husky/pre-push"; then
    errors+=(".husky/pre-push does not call scripts/preen/checkJs.sh --from-upstream")
  fi
  if ! grep -q "scripts/preen/checkClientBoundary.sh --from-upstream" ".husky/pre-push"; then
    errors+=(".husky/pre-push does not call scripts/preen/checkClientBoundary.sh --from-upstream")
  fi
fi

# Check 6: CI workflow includes binary, JS, and client boundary checks
if [ ! -f ".github/workflows/build.yml" ]; then
  errors+=("Missing .github/workflows/build.yml")
else
  if ! grep -q "checkBinaryFiles.sh" ".github/workflows/build.yml"; then
    errors+=(".github/workflows/build.yml does not include binary file check")
  fi
  if ! grep -q "scripts/preen/checkJs.sh" ".github/workflows/build.yml"; then
    errors+=(".github/workflows/build.yml does not include plain JavaScript file check")
  fi
  if ! grep -q "scripts/preen/checkClientBoundary.sh" ".github/workflows/build.yml"; then
    errors+=(".github/workflows/build.yml does not include client boundary check")
  fi
fi

# Check 7: Agent instructions include binary/JS policy
for file in CLAUDE.md AGENTS.md; do
  if [ -f "$file" ]; then
    if ! grep -q "Binary Files Policy" "$file"; then
      errors+=("$file missing Binary Files Policy section")
    fi
    if ! grep -q "plain JavaScript files" "$file"; then
      errors+=("$file missing plain JavaScript policy")
    fi
  fi
done

if [ "${#errors[@]}" -gt 0 ]; then
  echo "Error: File guardrails are misconfigured:" >&2
  printf '  - %s\n' "${errors[@]}" >&2
  echo "" >&2
  echo "These guardrails prevent binary and plain JavaScript files from being committed." >&2
  echo "Do not remove or weaken them without explicit approval." >&2
  exit 1
fi

echo "File guardrails verified successfully."
