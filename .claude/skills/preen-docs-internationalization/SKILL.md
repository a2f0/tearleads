---
name: preen-docs-internationalization
description: Preen documentation internationalization across all languages (project)
---


# Preen Docs Internationalization

Proactively translate and sync all English documentation to supported languages.

## When to Run

Run this skill when English docs have been updated, or during slack time to ensure translation coverage.

## Target Languages

Translate to all supported languages:

- `es` - Spanish
- `ua` - Ukrainian
- `pt` - Portuguese

## Discovery Phase

Check current translation coverage:

```bash
# Count docs per language
echo "English (source): $(ls docs/en/*.md 2>/dev/null | wc -l | tr -d ' ')"
echo "Spanish: $(ls docs/es/*.md 2>/dev/null | wc -l | tr -d ' ')"
echo "Ukrainian: $(ls docs/ua/*.md 2>/dev/null | wc -l | tr -d ' ')"
echo "Portuguese: $(ls docs/pt/*.md 2>/dev/null | wc -l | tr -d ' ')"

# Find missing translations
for lang in es ua pt; do
  for file in docs/en/*.md; do
    target="docs/$lang/$(basename "$file")"
    [ -f "$target" ] || echo "Missing: $target"
  done
done

# Find orphaned translations (files in target that don't exist in English)
for lang in es ua pt; do
  for file in docs/$lang/*.md; do
    [ -e "$file" ] || continue
    source="docs/en/$(basename "$file")"
    [ -f "$source" ] || echo "Orphaned: $file"
  done
done
```

## Translation Workflow

### 1. List all English docs (source of truth)

```bash
ls docs/en/*.md
```

### 2. For each target language, translate all docs

For each document in `docs/en/`:

- Read the English source
- Translate prose content to natural, professional language
- Preserve all markdown formatting, headings, code blocks, and links
- Keep technical terms, code snippets, file paths, and command examples unchanged
- Maintain the same file name in the target folder

### 3. Translation guidelines

**General:**

- Use formal language for instructions
- Keep product names and technical terms in English where appropriate
- Translate headings and section titles
- Preserve any frontmatter or metadata exactly as-is

**Spanish (es):**

- Use formal Spanish (usted form) for instructions
- "Getting Started" -> "Primeros Pasos"
- "Settings" -> "Configuración"
- "Privacy Policy" -> "Política de Privacidad"
- "Terms of Service" -> "Términos de Servicio"

**Ukrainian (ua):**

- Use formal Ukrainian for instructions
- "Getting Started" -> "Початок Роботи"
- "Settings" -> "Налаштування"
- "Privacy Policy" -> "Політика Конфіденційності"
- "Terms of Service" -> "Умови Використання"

**Portuguese (pt):**

- Use formal Portuguese (Brazil) for instructions
- "Getting Started" -> "Primeiros Passos"
- "Settings" -> "Configurações"
- "Privacy Policy" -> "Política de Privacidade"
- "Terms of Service" -> "Termos de Serviço"

### 4. Write translated files

```bash
# Write each translated file to docs/<lang>/<filename>.md
```

### 5. Cleanup orphaned docs

Delete files in target folders that no longer exist in English:

```bash
for lang in es ua pt; do
  for file in docs/$lang/*.md; do
    [ -e "$file" ] || continue
    source_file="docs/en/$(basename "$file")"
    if [ ! -f "$source_file" ]; then
      echo "Deleting orphaned file: $file"
      rm "$file"
    fi
  done
done
```

### 6. Verify coverage

```bash
echo "Translation coverage:"
for lang in es ua pt; do
  total=$(ls docs/en/*.md | wc -l | tr -d ' ')
  translated=$(ls docs/$lang/*.md 2>/dev/null | wc -l | tr -d ' ')
  echo "  $lang: $translated/$total"
done
```

## Quality Bar

- All English docs have translations in all target languages
- No orphaned translation files
- Markdown formatting preserved
- Code blocks and technical content unchanged
- Formal language used throughout

## Commit and Merge

After translating, use the standard preen workflow:

```bash
git add docs/
git commit -S -m "docs(i18n): sync translations with English source" >/dev/null
git push >/dev/null
```

Commit and push the changes, then enter the merge queue to complete the PR workflow.

## Token Efficiency

Process one language at a time to manage context:

1. Translate all docs to Spanish
2. Translate all docs to Ukrainian
3. Translate all docs to Portuguese

Suppress git operations:

```bash
git commit -S -m "message" >/dev/null
git push >/dev/null
```
