---
description: Translate English docs to target language
---

# Convert Docs

This skill translates all documentation from English (`docs/en/`) to a target language folder.

## Usage

Specify the target language when invoking:

- `/convert-docs es` - Translate to Spanish (`docs/es/`)
- `/convert-docs ua` - Translate to Ukrainian (`docs/ua/`)

## Instructions

1. **List all English docs** (source of truth):

```bash
ls docs/en/*.md
```

1. **List existing docs in target folder** (to identify orphans):

```bash
ls docs/<target>/*.md 2>/dev/null || echo "No existing docs"
```

1. **For each document in English**, read and create a translation:

- Preserve all markdown formatting, headings, code blocks, and links
- Translate prose content to natural, professional language
- Keep technical terms, code snippets, file paths, and command examples unchanged
- Maintain the same file name in the target folder

1. **Translation guidelines**:

- Use formal language for instructions
- Keep product names and technical terms in English where appropriate
- Translate headings and section titles
- Preserve any frontmatter or metadata exactly as-is

1. **Write each translated file** to `docs/<target>/<filename>.md`

1. **Cleanup orphaned docs**: Delete any files in the target folder that do not exist in `docs/en/`:

```bash
# For each file in target that doesn't have a corresponding English source, delete it
```

1. **Verify the translation** by listing the target folder:

```bash
ls docs/<target>/
```

## Language-Specific Guidelines

### Spanish (es)

- Use formal Spanish (usted form) for instructions
- "Getting Started" → "Primeros Pasos"
- "Settings" → "Configuración"

### Ukrainian (ua)

- Use formal Ukrainian for instructions
- "Getting Started" → "Початок Роботи"
- "Settings" → "Налаштування"

## Example

If `docs/en/getting-started.md` contains:

```markdown
# Getting Started

Follow these steps to set up the application.
```

The Spanish version in `docs/es/getting-started.md` should be:

```markdown
# Primeros Pasos

Siga estos pasos para configurar la aplicación.
```

The Ukrainian version in `docs/ua/getting-started.md` should be:

```markdown
# Початок Роботи

Виконайте ці кроки для налаштування додатку.
```
