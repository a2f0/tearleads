import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { i18n } from './i18n';
import { useTypedTranslation } from './hooks';

describe('useTypedTranslation', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  );

  it('returns a typed translation function without options', () => {
    const { result } = renderHook(() => useTypedTranslation('common'), {
      wrapper
    });

    expect(result.current.t('language')).toBe('Language');
  });

  it('returns a typed translation function with options', () => {
    const { result } = renderHook(() => useTypedTranslation('common'), {
      wrapper
    });

    expect(
      result.current.t('language', { defaultValue: 'Language' })
    ).toBe('Language');
  });
});
