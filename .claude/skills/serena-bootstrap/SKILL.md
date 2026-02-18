---
name: serena-bootstrap
description: Serena Bootstrap
---


# Serena Bootstrap

Configure Serena MCP on this machine, then start a session with a consistent bootstrap prompt.

## 1) One-time setup

```bash
./scripts/setupSerenaMcp.sh
```

This setup disables Serena's browser auto-open (`--open-web-dashboard false`)
to avoid opening localhost tabs during Codex/Claude startup.

## 2) Session bootstrap prompt

Use this as your first message in a new Codex or Claude Code chat:

```text
Call serena.activate_project with the current repo path,
then serena.check_onboarding_performed and serena.initial_instructions.
For this session, prefer Serena tools for symbol search/references/edits
before broad file reads.
```

## 3) Normal task prompt

After bootstrap, prompt normally. Example:

```text
Rename SessionConfig to RuntimeSessionConfig and update references.
```
