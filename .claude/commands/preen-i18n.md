---
description: Preen i18n translation coverage and consistency (project)
---

# Preen i18n

Proactively audit internationalization (i18n) for missing translations, hardcoded strings, and type/key mismatches across all supported languages.

## When to Run

Run this skill when maintaining translation coverage or during slack time. It searches for i18n gaps across the entire codebase.

## Discovery Phase

Search for i18n issues across packages:

```bash
# Count supported languages and translation files
echo "=== Translation Files ==="
find packages -path '*/i18n/translations/*.ts' -not -name 'types.ts' -not -name 'index.ts' | head -20

# Find hardcoded user-facing strings in components (potential missing translations)
echo "=== Potential Hardcoded Strings ==="
rg -n --glob '*.tsx' '>\s*[A-Z][a-z]+(\s+[a-z]+)*\s*<' packages | rg -v 'test\.' | head -20

# Find translation function usage
echo "=== Translation Usage ==="
rg -n --glob '*.{ts,tsx}' "useTranslation\(|t\('" packages | wc -l

# Compare key counts across language files
echo "=== Key Count by Language ==="
for lang in en es ua pt; do
  count=$(rg -o "^\s+\w+:" packages/client/src/i18n/translations/${lang}.ts 2>/dev/null | wc -l | tr -d ' ')
  echo "${lang}: ${count} keys"
done

# Find keys in non-English files missing from English (source of truth violations)
echo "=== Potential Orphan Keys ==="
for lang in es ua pt; do
  diff <(rg -o "^\s+(\w+):" packages/client/src/i18n/translations/en.ts | sort) \
       <(rg -o "^\s+(\w+):" packages/client/src/i18n/translations/${lang}.ts 2>/dev/null | sort) \
       2>/dev/null | rg '^>' | head -5
done

# Find missing namespace registrations
echo "=== Namespace Registration ==="
rg "ns:\s*\[" packages/client/src/i18n/i18n.ts | head -5
```

## Prioritization

Fix issues in this order (highest impact first):

1. **Type interface mismatches** - Keys in code but not in `types.ts`
2. **Missing English keys** - Keys used but not in `en.ts` (source of truth)
3. **Cross-language gaps** - Keys in `en.ts` missing from other languages
4. **Hardcoded strings** - User-facing text not using `t()` function
5. **Orphan keys** - Keys in non-English files not in `en.ts`
6. **Namespace registration** - Namespaces not registered in i18n config

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

1. **Discovery**: Run discovery commands to identify i18n gaps.
2. **Selection**: Choose the highest-impact category of issues.
3. **Create branch**: `git checkout -b refactor/i18n-<area>`
4. **Fix types**: Update `types.ts` interfaces if needed.
5. **Update English**: Add missing keys to `en.ts` first.
6. **Sync languages**: Propagate keys to other language files.
7. **Fix components**: Replace hardcoded strings with `t()` calls.
8. **Validate**: Run `pnpm typecheck` and tests.
9. **Commit and merge**: Run `/commit-and-push`, then `/enter-merge-queue`.

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

Discovery commands can return many lines. Always limit output:

```bash
# Count first, then list limited results
find packages -path '*/i18n/translations/*.ts' | wc -l
rg -l ... | head -20

# Suppress verbose validation output
pnpm typecheck >/dev/null
pnpm lint >/dev/null
pnpm test >/dev/null
git commit -S -m "message" >/dev/null
git push >/dev/null
```

On failure, re-run without suppression to see errors.
