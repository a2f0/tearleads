---
name: preen-skill-tooling
description: Validate skills are wired into agentTool.ts and scriptTool.ts
---

# Preen Skill Tooling

Validate that skills referencing `agentTool.ts` or `scriptTool.ts` actions are using actions that actually exist, and identify dead code (actions defined but never used by any skill).

## When to Run

Run this skill when:

- Adding new actions to `agentTool.ts` or `scriptTool.ts`
- Creating or modifying skills that invoke tool wrappers
- During regular preen passes to catch drift between skills and tool definitions

## Discovery Phase

### 1. Extract defined actions from tool wrappers

```bash
# agentTool.ts actions (from ACTION_CONFIG keys)
echo "=== agentTool.ts defined actions ==="
grep -oP "^\s+'[a-zA-Z]+'" scripts/agents/tooling/agentTool.ts | tr -d "' " | sort -u

# scriptTool.ts actions (from ACTION_CONFIG keys)
echo "=== scriptTool.ts defined actions ==="
grep -oP "^\s+'[a-zA-Z]+'" scripts/tooling/scriptTool.ts | tr -d "' " | sort -u
```

### 2. Extract invoked actions from skills

```bash
# agentTool.ts invocations in Claude skills
echo "=== agentTool.ts invocations in Claude skills ==="
grep -rh "agentTool\.ts" .claude/commands/*.md | grep -oP "agentTool\.ts\s+\K[a-zA-Z]+" | sort -u

# agentTool.ts invocations in Codex skills
echo "=== agentTool.ts invocations in Codex skills ==="
grep -rh "agentTool\.ts" .codex/skills/*/SKILL.md | grep -oP "agentTool\.ts\s+\K[a-zA-Z]+" | sort -u

# scriptTool.ts invocations in Claude skills
echo "=== scriptTool.ts invocations in Claude skills ==="
grep -rh "scriptTool\.ts" .claude/commands/*.md | grep -oP "scriptTool\.ts\s+\K[a-zA-Z]+" | sort -u

# scriptTool.ts invocations in Codex skills
echo "=== scriptTool.ts invocations in Codex skills ==="
grep -rh "scriptTool\.ts" .codex/skills/*/SKILL.md | grep -oP "scriptTool\.ts\s+\K[a-zA-Z]+" | sort -u
```

### 3. Cross-reference for issues

```bash
# Find undefined actions (invoked but not defined)
echo "=== Checking for undefined agentTool actions ==="
DEFINED=$(grep -oP "^\s+'[a-zA-Z]+'" scripts/agents/tooling/agentTool.ts | tr -d "' " | sort -u)
INVOKED=$(grep -rh "agentTool\.ts" .claude/commands/*.md .codex/skills/*/SKILL.md 2>/dev/null | grep -oP "agentTool\.ts\s+\K[a-zA-Z]+" | sort -u)
comm -23 <(echo "$INVOKED") <(echo "$DEFINED")

echo "=== Checking for undefined scriptTool actions ==="
DEFINED=$(grep -oP "^\s+'[a-zA-Z]+'" scripts/tooling/scriptTool.ts | tr -d "' " | sort -u)
INVOKED=$(grep -rh "scriptTool\.ts" .claude/commands/*.md .codex/skills/*/SKILL.md 2>/dev/null | grep -oP "scriptTool\.ts\s+\K[a-zA-Z]+" | sort -u)
comm -23 <(echo "$INVOKED") <(echo "$DEFINED")

# Find dead code (defined but never invoked)
echo "=== Checking for unused agentTool actions ==="
DEFINED=$(grep -oP "^\s+'[a-zA-Z]+'" scripts/agents/tooling/agentTool.ts | tr -d "' " | sort -u)
INVOKED=$(grep -rh "agentTool\.ts" .claude/commands/*.md .codex/skills/*/SKILL.md 2>/dev/null | grep -oP "agentTool\.ts\s+\K[a-zA-Z]+" | sort -u)
comm -23 <(echo "$DEFINED") <(echo "$INVOKED")

echo "=== Checking for unused scriptTool actions ==="
DEFINED=$(grep -oP "^\s+'[a-zA-Z]+'" scripts/tooling/scriptTool.ts | tr -d "' " | sort -u)
INVOKED=$(grep -rh "scriptTool\.ts" .claude/commands/*.md .codex/skills/*/SKILL.md 2>/dev/null | grep -oP "scriptTool\.ts\s+\K[a-zA-Z]+" | sort -u)
comm -23 <(echo "$DEFINED") <(echo "$INVOKED")
```

## Issue Categories

| Category | Severity | Action |
| -------- | -------- | ------ |
| Undefined action invoked | High | Fix skill to use correct action name, or add missing action to tool |
| Defined action never used | Low | Consider removing dead code, or document why it exists |
| Skill/Codex parity mismatch | Medium | Ensure both Claude and Codex versions reference same actions |

## Prioritization

Fix issues in this order:

1. **Undefined actions** - Skills will fail at runtime
2. **Parity mismatches** - Claude and Codex skills should be identical
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

1. Compare `.claude/commands/<skill>.md` with `.codex/skills/<skill>/SKILL.md`
2. Sync the files to use identical action references
3. Run the parity check from main `preen` skill

## Workflow

1. **Discovery**: Run discovery commands to identify mismatches
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
- Keep Claude and Codex skill files in sync
- Add tests when adding new actions

## Quality Bar

- Zero undefined action references in skills
- Zero parity mismatches between Claude and Codex skills
- All unused actions either removed or documented
- Tool wrapper tests pass

## Token Efficiency

```bash
# Limit discovery output
grep -rh "agentTool\.ts" .claude/commands/*.md | head -20
grep -rh "scriptTool\.ts" .claude/commands/*.md | head -20

# Suppress validation output
pnpm typecheck >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to see errors.
