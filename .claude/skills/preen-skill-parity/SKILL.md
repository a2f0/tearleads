---
name: preen-skill-parity
description: Ensure skill definitions stay consistent across OpenCode, Codex, Gemini, and Claude.
---


# Preen Skill Parity

Ensure skill definitions remain consistent across OpenCode, Codex, Gemini, and Claude.

## When to Run

- Adding or renaming skills
- Editing skill instructions
- Syncing OpenCode skills
- Changing skill tooling or parity checks

## Fast Path

```bash
./scripts/checkSkillParity.sh --summary
```

If issues are reported, rerun with strict mode after fixes:

```bash
./scripts/checkSkillParity.sh --strict
```

## Canonicalization Rules

- Skill IDs come from skill folder names.
- Codex `misc/preen-enhancements` is treated as `preen-enhancements` for parity.
- Command prefixes are normalized (slash vs dollar) before diffing.

## Discovery Commands

```bash
find .codex/skills -type f -name SKILL.md -print
find .gemini/skills -type f -name SKILL.md -print
find .opencode/skills -type f -name SKILL.md -print
find .claude/commands -maxdepth 1 -type f -name '*.md' -print
```

## Fix Workflow

1. Update the canonical skill (prefer the Codex version).
2. Sync Gemini, Claude, and OpenCode by copying the updated `SKILL.md`.
3. For OpenCode, ensure `name` matches the directory and uses only lowercase letters, numbers, and hyphens.
4. Re-run the parity check until clean.
