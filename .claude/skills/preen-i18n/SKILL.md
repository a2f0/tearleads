---
name: preen-i18n
description: Preen i18n translation coverage and consistency (project)
---


# Preen i18n

Proactively audit internationalization (i18n) for missing translations, hardcoded strings, and type/key mismatches across all supported languages.

## When to Run

Run this skill when maintaining translation coverage or during slack time. It searches for i18n gaps across the entire codebase.

## Tooling

This skill uses `scripts/preen/checkI18nCoverage.ts` for automated detection:

```bash
# Text summary (default)
./scripts/preen/checkI18nCoverage.ts

# JSON output for programmatic use
./scripts/preen/checkI18nCoverage.ts --json

# Strict mode (exit 1 if issues found) - used in CI
./scripts/preen/checkI18nCoverage.ts --strict
```

The tool detects:

1. **JSX text content** - `<span>Hello</span>` should be `<span>{t('key')}</span>`
2. **User-facing attributes** - `title="Hello"`, `label="Submit"`, `trigger="File"`, etc.
3. **Array literals with labels** - `{ id: 'x', label: 'Text' }` patterns
4. **Missing translation keys** across languages
5. **Orphan keys** in non-English files

### User-Facing Attributes Detected

The tool checks these attributes for hardcoded strings:

- `title`, `label`, `placeholder`, `alt`
- `aria-label`, `aria-description`
- `trigger`, `appName`, `closeLabel`
- `description`, `helperText`, `errorMessage`, `successMessage`
- `emptyMessage`, `loadingText`, `buttonText`
- `submitLabel`, `cancelLabel`, `confirmLabel`
- `header`, `subheader`, `tooltip`

## Discovery Phase

Run the automated tool first:

```bash
# Quick summary
./scripts/preen/checkI18nCoverage.ts

# Get metrics for quality delta
BASELINE=$(./scripts/preen/checkI18nCoverage.ts --json | jq '.hardcodedStringCount')
echo "Baseline hardcoded strings: $BASELINE"
```

For deeper exploration:

```bash
# Find hardcoded strings in a specific package
./scripts/preen/checkI18nCoverage.ts --json | jq '.hardcodedStrings[] | select(.file | contains("notifications"))'

# Count by file (highest first)
./scripts/preen/checkI18nCoverage.ts --json | jq '.hardcodedByFile[:10]'

# Find translation function usage patterns
rg -n --glob '*.{ts,tsx}' "useTranslation\(|t\('" packages | wc -l

# Check namespace registrations
rg "ns:\s*\[" packages/client/src/i18n/i18n.ts
```

## Prioritization

Fix issues in this order (highest impact first):

1. **Hardcoded strings in high-traffic components** - Menu bars, tabs, headers, dialogs
2. **Type interface mismatches** - Keys in code but not in `types.ts`
3. **Missing English keys** - Keys used but not in `en.ts` (source of truth)
4. **Cross-language gaps** - Keys in `en.ts` missing from other languages
5. **Orphan keys** - Keys in non-English files not in `en.ts`
6. **Namespace registration** - Namespaces not registered in i18n config

### Identifying High-Impact Files

Focus on files with the most hardcoded strings first:

```bash
./scripts/preen/checkI18nCoverage.ts --json | jq '.hardcodedByFile[:15]'
```

Common high-impact patterns:

- **Menu bars** - `trigger="File"`, `trigger="Help"`, etc.
- **Tab labels** - `{ id: 'x', label: 'Tab Name' }`
- **Window titles** - `title="Window Name"`
- **Dialog buttons** - `confirmLabel`, `cancelLabel`, `closeLabel`
- **Empty states** - "No items", "Loading...", etc.

## Replacement Strategies

### Adding Missing Translation Keys

```typescript
// 1. Add to types.ts interface first
export interface CommonTranslations {
  // ... existing
  newKey: string;  // Add new key type
}

// 2. Add to en.ts (source of truth)
export const en = {
  common: {
    // ... existing
    newKey: 'English text here'
  }
} as const satisfies I18NextTranslations;

// 3. Add to all other language files
// es.ts
export const es = {
  common: {
    // ... existing
    newKey: 'Texto en español'
  }
} as const satisfies I18NextTranslations;
```

### Fixing Hardcoded Strings

```typescript
// Before - hardcoded string
function MyComponent() {
  return <button>Submit Form</button>;
}

// After - using translation
function MyComponent() {
  const { t } = useTranslation('common');
  return <button>{t('submitForm')}</button>;
}
```

### Adding Missing Namespace

```typescript
// In i18n.ts, add namespace to array
i18n.init({
  // ...
  ns: ['common', 'menu', 'audio', 'newNamespace'],  // Add new namespace
  defaultNS: 'common',
});

// Ensure namespace is loaded in loadLanguage()
export async function loadLanguage(lang: SupportedLanguage): Promise<void> {
  // ...
  i18n.addResourceBundle(lang, 'newNamespace', translations[lang].newNamespace, true, true);
}
```

### Syncing Translation Files

When `en.ts` has keys missing from other files:

```typescript
// Add placeholder for missing keys in other languages
// This makes the gap visible and allows gradual translation
export const es = {
  common: {
    existingKey: 'Traducción existente',
    newKey: ''  // TODO: translate - English: "New key text"
  }
} as const satisfies I18NextTranslations;
```

## Workflow

### 1. Capture Baseline

```bash
BASELINE=$(./scripts/preen/checkI18nCoverage.ts --json | jq '.hardcodedStringCount')
echo "Baseline: $BASELINE hardcoded strings"
```

### 2. Discovery and Selection

```bash
# Identify high-impact files
./scripts/preen/checkI18nCoverage.ts --json | jq '.hardcodedByFile[:10]'

# Focus on a specific component/package
./scripts/preen/checkI18nCoverage.ts --json | jq '.hardcodedStrings[] | select(.file | contains("<target>"))'
```

Choose the highest-impact area (e.g., notification center, settings, menu bars).

### 3. Create Branch

```bash
git checkout -b refactor/i18n-<area>
```

### 4. Add Translation Infrastructure

If the component doesn't use translations yet:

```typescript
import { useTranslation } from 'react-i18next';

export function MyComponent() {
  const { t } = useTranslation('common'); // or appropriate namespace
  // ...
}
```

### 5. Fix Types First

Add keys to `types.ts` interface:

```typescript
// packages/client/src/i18n/translations/types.ts
export interface CommonTranslations {
  // ... existing
  newKey: string;
}
```

### 6. Update English (Source of Truth)

Add keys to `en.ts`:

```typescript
// packages/client/src/i18n/translations/en.ts
export const en = {
  common: {
    // ... existing
    newKey: 'English text here'
  }
} as const satisfies I18NextTranslations;
```

### 7. Sync Other Languages

Add keys to `es.ts`, `ua.ts`, `pt.ts`:

```typescript
// Use empty string for untranslated (makes gap visible)
newKey: ''  // TODO: translate - English: "English text here"
```

### 8. Replace Hardcoded Strings

```typescript
// Before
<DropdownMenu trigger="File">
  <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
</DropdownMenu>

// After
<DropdownMenu trigger={t('menu.file')}>
  <DropdownMenuItem onClick={onClose}>{t('common.close')}</DropdownMenuItem>
</DropdownMenu>
```

### 9. Validate Quality Delta

```bash
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null

AFTER=$(./scripts/preen/checkI18nCoverage.ts --json | jq '.hardcodedStringCount')
echo "Before: $BASELINE → After: $AFTER (reduced by $((BASELINE - AFTER)))"
```

### 10. Commit and Merge

Use the `commit-and-push` skill followed by the `enter-merge-queue` skill to commit changes and enter the merge queue.

If no high-value fixes were found during discovery, do not create a branch or run commit/merge workflows.

## Guardrails

- Do not change translation text meaning unless fixing a clear error
- Do not remove existing translations (may be used elsewhere)
- Always update `types.ts` before adding keys to translation files
- Always add to `en.ts` before other language files
- Use empty string placeholders for untranslated text, not English text
- Keep PRs focused on one namespace or component area
- Add tests for new translation hooks or utilities

## Quality Bar

- Zero type errors in translation files
- All keys in `en.ts` present in other language files
- No orphan keys in non-English files
- All existing tests pass
- Lint and typecheck pass
- Hardcoded string count reduced (measurable quality delta)

## CI Integration

The `checkI18nCoverage.ts` script runs in CI with `--strict` mode to block PRs that introduce new hardcoded strings.

```bash
# This runs in CI and fails if hardcoded strings are found
./scripts/preen/checkI18nCoverage.ts --strict
```

**Note**: The strict mode is being gradually adopted. Initially it may report many existing issues. As we fix them through preen passes, the baseline will decrease.

## PR Strategy

Use incremental PRs by category:

- PR 1: Fix type interface mismatches
- PR 2: Add missing keys to `en.ts`
- PR 3: Sync keys across language files
- PR 4: Replace hardcoded strings in specific component area

In each PR description, include:

- What category of i18n issues were fixed
- Files changed and why
- Any new namespaces or keys added
- Translation coverage before/after

## Token Efficiency

Use JSON output with jq filtering for precise data:

```bash
# Get only the metrics you need
./scripts/preen/checkI18nCoverage.ts --json | jq '{count: .hardcodedStringCount, topFiles: .hardcodedByFile[:5]}'

# Filter to specific package
./scripts/preen/checkI18nCoverage.ts --json | jq '.hardcodedStrings[] | select(.file | contains("notifications")) | {file, line, value}'

# Suppress verbose validation output
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to see errors.
