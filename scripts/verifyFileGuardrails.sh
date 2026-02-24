#!/usr/bin/env bash
set -euo pipefail

# This script verifies that file guardrails (binary and JS) are properly configured.
# It runs in CI to prevent agents from accidentally removing these protections.

errors=()

# Check 1: Binary check script exists
if [ ! -f "scripts/checks/checkBinaryFiles.sh" ]; then
  errors+=("Missing scripts/checks/checkBinaryFiles.sh")
elif [ ! -x "scripts/checks/checkBinaryFiles.sh" ]; then
  errors+=("scripts/checks/checkBinaryFiles.sh is not executable")
fi

# Check 2: JavaScript check script exists
if [ ! -f "scripts/checks/checkJs.sh" ]; then
  errors+=("Missing scripts/checks/checkJs.sh")
elif [ ! -x "scripts/checks/checkJs.sh" ]; then
  errors+=("scripts/checks/checkJs.sh is not executable")
fi

# Check 3: Client boundary check script exists
if [ ! -f "scripts/checks/checkClientBoundary.sh" ]; then
  errors+=("Missing scripts/checks/checkClientBoundary.sh")
elif [ ! -x "scripts/checks/checkClientBoundary.sh" ]; then
  errors+=("scripts/checks/checkClientBoundary.sh is not executable")
fi

# Check 4: File naming check script exists
if [ ! -f "scripts/checks/checkFileNames.sh" ]; then
  errors+=("Missing scripts/checks/checkFileNames.sh")
elif [ ! -x "scripts/checks/checkFileNames.sh" ]; then
  errors+=("scripts/checks/checkFileNames.sh is not executable")
fi

# Check 5: API boundary check script exists
if [ ! -f "scripts/checks/checkApiBoundary.sh" ]; then
  errors+=("Missing scripts/checks/checkApiBoundary.sh")
elif [ ! -x "scripts/checks/checkApiBoundary.sh" ]; then
  errors+=("scripts/checks/checkApiBoundary.sh is not executable")
fi

# Check 6: Pre-commit hook exists and calls binary check
if [ ! -f ".husky/pre-commit" ]; then
  errors+=("Missing .husky/pre-commit hook")
elif ! grep -q "checkBinaryFiles.sh --staged" ".husky/pre-commit"; then
  errors+=(".husky/pre-commit does not call checkBinaryFiles.sh --staged")
fi

# Check 7: Pre-push hook calls binary, JS, filename, and boundary checks
if [ ! -f ".husky/pre-push" ]; then
  errors+=("Missing .husky/pre-push hook")
else
  if ! grep -q "scripts/checks/checkBinaryFiles.sh --from-upstream" ".husky/pre-push"; then
    errors+=(".husky/pre-push does not call scripts/checks/checkBinaryFiles.sh --from-upstream")
  fi
  if ! grep -q "scripts/checks/checkJs.sh --from-upstream" ".husky/pre-push"; then
    errors+=(".husky/pre-push does not call scripts/checks/checkJs.sh --from-upstream")
  fi
  if ! grep -q "scripts/checks/checkFileNames.sh --from-upstream" ".husky/pre-push"; then
    errors+=(".husky/pre-push does not call scripts/checks/checkFileNames.sh --from-upstream")
  fi
  if ! grep -q "scripts/checks/checkClientBoundary.sh --from-upstream" ".husky/pre-push"; then
    errors+=(".husky/pre-push does not call scripts/checks/checkClientBoundary.sh --from-upstream")
  fi
  if ! grep -q "scripts/checks/checkApiBoundary.sh --from-upstream" ".husky/pre-push"; then
    errors+=(".husky/pre-push does not call scripts/checks/checkApiBoundary.sh --from-upstream")
  fi
fi

# Check 8: CI workflow includes binary, JS, filename, and boundary checks
if [ ! -f ".github/workflows/build.yml" ]; then
  errors+=("Missing .github/workflows/build.yml")
else
  if ! grep -q "scripts/checks/checkBinaryFiles.sh" ".github/workflows/build.yml"; then
    errors+=(".github/workflows/build.yml does not include binary file check")
  fi
  if ! grep -q "scripts/checks/checkJs.sh" ".github/workflows/build.yml"; then
    errors+=(".github/workflows/build.yml does not include plain JavaScript file check")
  fi
  if ! grep -q "scripts/checks/checkFileNames.sh" ".github/workflows/build.yml"; then
    errors+=(".github/workflows/build.yml does not include TypeScript file naming check")
  fi
  if ! grep -q "scripts/checks/checkClientBoundary.sh" ".github/workflows/build.yml"; then
    errors+=(".github/workflows/build.yml does not include client boundary check")
  fi
  if ! grep -q "scripts/checks/checkApiBoundary.sh" ".github/workflows/build.yml"; then
    errors+=(".github/workflows/build.yml does not include API boundary check")
  fi
fi

# Check 9: Agent instructions include binary/JS policy
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
