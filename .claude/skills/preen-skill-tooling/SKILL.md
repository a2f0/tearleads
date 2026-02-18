---
name: preen-skill-tooling
description: Validate skills are wired into agentTool.ts and scriptTool.ts
---


# Preen Skill Tooling

Validate that skills referencing `agentTool.ts` or `scriptTool.ts` actions are using actions that actually exist, identify dead code (actions defined but never used by any skill), and ensure auto-generated documentation is up to date.

## When to Run

Run this skill when:

- Adding new actions to `agentTool.ts` or `scriptTool.ts`
- Creating or modifying skills that invoke tool wrappers
- During regular preen passes to catch drift between skills and tool definitions

## Fast Path

Run the single-source checker first:

```bash
./scripts/checkPreenEcosystem.sh --strict
```

This validates:

- Semantic parity between `.claude/commands/preen*.md`, `.codex/skills/preen*/SKILL.md`, and `.gemini/skills/preen*/SKILL.md`
- Command prefix style (`/command` in Claude docs, `$command` in Codex docs, `/command` in Gemini docs)
- Top-level preen docs are generated from `scripts/preen/registry.json`

## Discovery Phase

### 1. Extract defined actions from tool wrappers

```bash
extract_union_actions() {
  local file="$1"
  awk '
    /^type ActionName =/ {in_union=1; next}
    in_union {
      print
      if ($0 ~ /;/) in_union=0
    }
  ' "$file" | rg -o "'[A-Za-z][A-Za-z0-9]*'" | tr -d "'" | sort -u
}

echo "=== agentTool.ts defined actions ==="
extract_union_actions scripts/agents/tooling/agentTool.ts

echo "=== scriptTool.ts defined actions ==="
extract_union_actions scripts/tooling/scriptTool.ts
```

### 2. Extract invoked actions from skills

```bash
# agentTool.ts invocations in Claude skills
echo "=== agentTool.ts invocations in Claude skills ==="
rg --no-filename "/agentTool\.ts" .claude/commands/*.md | rg -o "agentTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u

# agentTool.ts invocations in Codex skills
echo "=== agentTool.ts invocations in Codex skills ==="
rg --no-filename "/agentTool\.ts" .codex/skills/*/SKILL.md | rg -o "agentTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u

# agentTool.ts invocations in Gemini skills
echo "=== agentTool.ts invocations in Gemini skills ==="
rg --no-filename "/agentTool\.ts" .gemini/skills/*/SKILL.md | rg -o "agentTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u

# scriptTool.ts invocations in Claude skills
echo "=== scriptTool.ts invocations in Claude skills ==="
rg --no-filename "/scriptTool\.ts" .claude/commands/*.md | rg -o "scriptTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u

# scriptTool.ts invocations in Codex skills
echo "=== scriptTool.ts invocations in Codex skills ==="
rg --no-filename "/scriptTool\.ts" .codex/skills/*/SKILL.md | rg -o "scriptTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u

# scriptTool.ts invocations in Gemini skills
echo "=== scriptTool.ts invocations in Gemini skills ==="
rg --no-filename "/scriptTool\.ts" .gemini/skills/*/SKILL.md | rg -o "scriptTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u
```

### 3. Cross-reference for issues

```bash
extract_union_actions() {
  local file="$1"
  awk '
    /^type ActionName =/ {in_union=1; next}
    in_union {
      print
      if ($0 ~ /;/) in_union=0
    }
  ' "$file" | rg -o "'[A-Za-z][A-Za-z0-9]*'" | tr -d "'" | sort -u
}

# Find undefined actions (invoked but not defined)
echo "=== Checking for undefined agentTool actions ==="
DEFINED=$(extract_union_actions scripts/agents/tooling/agentTool.ts)
INVOKED=$(rg --no-filename "/agentTool\.ts" .claude/commands/*.md .codex/skills/*/SKILL.md .gemini/skills/*/SKILL.md 2>/dev/null | rg -o "agentTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u)
comm -23 <(echo "$INVOKED") <(echo "$DEFINED")

echo "=== Checking for undefined scriptTool actions ==="
DEFINED=$(extract_union_actions scripts/tooling/scriptTool.ts)
INVOKED_ALL=$(rg --no-filename "/scriptTool\.ts" .claude/commands/*.md .codex/skills/*/SKILL.md .gemini/skills/*/SKILL.md 2>/dev/null | rg -o "scriptTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u)
# scriptTool.ts expose `generateDocs` as a top-level command (not in ActionName union).
INVOKED=$(echo "$INVOKED_ALL" | rg -v '^generateDocs$' || true)
comm -23 <(echo "$INVOKED") <(echo "$DEFINED")

# Find dead code (defined but never invoked)
echo "=== Checking for unused agentTool actions ==="
DEFINED=$(extract_union_actions scripts/agents/tooling/agentTool.ts)
INVOKED=$(rg --no-filename "/agentTool\.ts" .claude/commands/*.md .codex/skills/*/SKILL.md .gemini/skills/*/SKILL.md 2>/dev/null | rg -o "agentTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u)
comm -23 <(echo "$DEFINED") <(echo "$INVOKED")

echo "=== Checking for unused scriptTool actions ==="
DEFINED=$(extract_union_actions scripts/tooling/scriptTool.ts)
INVOKED_ALL=$(rg --no-filename "/scriptTool\.ts" .claude/commands/*.md .codex/skills/*/SKILL.md .gemini/skills/*/SKILL.md 2>/dev/null | rg -o "scriptTool\.ts\s+[A-Za-z][A-Za-z0-9]*" | awk '{print $2}' | sort -u)
INVOKED=$(echo "$INVOKED_ALL" | rg -v '^generateDocs$' || true)
comm -23 <(echo "$DEFINED") <(echo "$INVOKED")
```

### 4. Check documentation freshness

```bash
# Check if scriptTool.ts README is up to date
echo "=== Checking scriptTool.ts README freshness ==="
./scripts/tooling/scriptTool.ts generateDocs --json
# If "changed": true, the README needs regeneration
```

## Issue Categories

| Category | Severity | Action |
| -------- | -------- | ------ |
| Undefined action invoked | High | Fix skill to use correct action name, or add missing action to tool |
| Defined action never used | Low | Consider removing dead code, or document why it exists |
| Skill parity mismatch | Medium | Ensure Claude, Codex, and Gemini versions reference equivalent actions |
| README out of date | Medium | Run `./scripts/tooling/scriptTool.ts generateDocs` to regenerate |

## Prioritization

Fix issues in this order:

1. **Undefined actions** - Skills will fail at runtime
2. **Parity mismatches** - All agent versions should be equivalent for runtime behavior
3. **Unused actions** - Dead code, lower priority unless cleanup pass

## Fix Strategies

### Undefined Action

1. Check if it's a typo in the skill
2. Check if the action was renamed in the tool
3. If the action should exist, add it to the tool with proper typing

### Unused Action

1. Search for direct invocations outside skills (scripts, CI, etc.)
2. If truly unused, remove from `ACTION_CONFIG`
3. If intentionally available for manual use, add a comment explaining why

### Parity Mismatch

1. Compare `.claude/commands/<skill>.md`, `.codex/skills/<skill>/SKILL.md`, and `.gemini/skills/<skill>/SKILL.md`
2. Sync the files to use equivalent action references
3. Run the parity check from main `preen` skill

### README Out of Date

1. Run `./scripts/tooling/scriptTool.ts generateDocs` to regenerate
2. Review the diff to ensure changes are expected
3. Commit the updated README

## Workflow

1. **Discovery**: Run `./scripts/checkPreenEcosystem.sh --summary` and targeted discovery commands as needed
2. **Categorize**: Group findings by severity
3. **Create branch**: `git checkout -b refactor/skill-tooling-<date>`
4. **Fix issues**: Update skills or tools as needed
5. **Validate**: Run discovery again to confirm fixes
6. **Test**: Ensure affected skills still work
7. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`

If no issues found during discovery, do not create a branch.

## Guardrails

- Do not remove actions that are used by scripts outside of skills
- Do not change action behavior when fixing wiring issues
- Keep Claude, Codex, and Gemini skill files in sync
- Add tests when adding new actions

## Quality Bar

- Zero undefined action references in skills
- Zero unresolved parity mismatches between agent skills
- All unused actions either removed or documented
- Tool wrapper tests pass
- Auto-generated READMEs are up to date
