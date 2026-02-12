---
name: convert-docs
description: Translate docs from `docs/en/` into a target language folder while preserving markdown structure and pruning orphaned translated files.
---

# Convert Docs

Translate all documentation from English (`docs/en/`) into a target language folder (for example `docs/es/` or `docs/ua/`).

## Inputs

- `target` language code (for example `es`, `ua`).

## Workflow
<!-- markdownlint-disable MD029 -->
1. List English source docs:

```bash
ls docs/en/*.md
```

2. List existing docs in the target folder:

```bash
ls docs/<target>/*.md 2>/dev/null || echo "No existing docs"
```

3. For each file in `docs/en/`, create/update `docs/<target>/<same-filename>.md`:

- Preserve markdown structure exactly: headings, lists, links, code blocks, frontmatter, and metadata.
- Translate prose naturally and professionally.
- Keep technical terms, commands, file paths, and code snippets unchanged unless translation is clearly appropriate.

4. Apply language guidance:

- Spanish (`es`): formal Spanish (`usted`), e.g. "Getting Started" -> "Primeros Pasos", "Settings" -> "Configuración".
- Ukrainian (`ua`): formal Ukrainian, e.g. "Getting Started" -> "Початок роботи", "Settings" -> "Налаштування".

5. Remove orphaned files in the target folder (files not present in `docs/en/`):

```bash
for file in docs/<target>/*.md; do
  [ -e "$file" ] || continue
  source_file="docs/en/$(basename "$file")"
  if [ ! -f "$source_file" ]; then
    echo "Deleting orphaned file: $file"
    rm "$file"
  fi
done
```

6. Verify final target folder contents:

```bash
ls docs/<target>/
```

7. Finish automation:
<!-- markdownlint-enable MD029 -->

- Run the `commit-and-push` skill to commit and push the translation changes.
- Then run the `enter-merge-queue` skill so the PR is carried through merge.

## Quality Bar

- Every file in `docs/en/` has a same-named translated counterpart in `docs/<target>/`.
- No orphaned translated files remain.
- Formatting and code samples are structurally identical to source docs.
