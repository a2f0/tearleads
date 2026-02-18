# Internationalization (i18n) Review Guidelines

This document provides detailed review guidelines for internationalization (i18n) in the Tearleads codebase.

## Translation Architecture

This codebase uses i18next with typed translations:

```text
packages/client/src/i18n/
  i18n.ts              # i18next configuration
  hooks.ts             # useTranslation wrapper hooks
  translations/
    types.ts           # TypeScript interfaces for all namespaces
    en.ts              # English (base language, always complete)
    es.ts              # Spanish
    ua.ts              # Ukrainian
    pt.ts              # Portuguese
    index.ts           # Re-exports
```

## Required Patterns

1. **Type-safe translations** - All translation files must satisfy `I18NextTranslations`
2. **Namespace separation** - Group related strings (`common`, `menu`, `audio`, etc.)
3. **English as source of truth** - Add new keys to `en.ts` first, then propagate
4. **Lazy loading** - Non-English languages load on demand via `loadLanguage()`

## Adding New Translation Keys

```typescript
// 1. Add interface in types.ts
export interface NewNamespaceTranslations {
  keyName: string;
  anotherKey: string;
}

// Update Translations interface
export interface Translations {
  // ... existing namespaces
  newNamespace: NewNamespaceTranslations;
}

// 2. Add to en.ts (base language)
export const en = {
  // ... existing
  newNamespace: {
    keyName: 'English text',
    anotherKey: 'More text'
  }
} as const satisfies I18NextTranslations;

// 3. Add to all other language files (es.ts, ua.ts, pt.ts)
```

## What to Flag in Reviews

- [ ] New user-facing strings not in translation files
- [ ] Hardcoded strings in components (should use `t()` or `useTranslation`)
- [ ] Missing keys in non-English translation files
- [ ] Translation keys added to non-English files but missing from `en.ts`
- [ ] Type mismatches between `types.ts` interfaces and translation objects
- [ ] Namespace not registered in i18n.ts `ns` array

## Prohibited Patterns

```typescript
// BAD: Hardcoded strings
<button>Submit</button>

// GOOD: Translated strings
const { t } = useTranslation('common');
<button>{t('submit')}</button>

// BAD: Inline translation objects (bypasses type checking)
i18n.addResourceBundle('en', 'ns', { key: 'value' });

// GOOD: Import from typed translation files
import { en } from './translations/en';
```

## Translation File Parity

All translation files must have the same keys. When reviewing changes to translation files:

1. Verify the key exists in `en.ts` (source of truth)
2. Verify the key is defined in `types.ts` interfaces
3. Check that other language files have the key (can be empty string as placeholder)

## Testing Translations

```typescript
// Test that translations load correctly
it('loads Spanish translations', async () => {
  await loadLanguage('es');
  expect(i18n.hasResourceBundle('es', 'common')).toBe(true);
});

// Test component uses translation
it('displays translated button text', () => {
  render(<MyComponent />);
  expect(screen.getByRole('button')).toHaveTextContent(/submit/i);
});
```
