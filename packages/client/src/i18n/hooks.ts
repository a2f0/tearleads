import { useTranslation as useTranslationBase } from 'react-i18next';

import type { NamespaceKeys, TranslationKeys } from './translations';

type TypedTFunction<NS extends NamespaceKeys> = (
  key: Extract<TranslationKeys<NS>, string>,
  options?: Record<string, unknown>
) => string;

export function useTypedTranslation<NS extends NamespaceKeys = 'common'>(
  namespace?: NS
) {
  const { t, i18n, ready } = useTranslationBase(namespace);

  const typedT: TypedTFunction<NS> = (key, options) => {
    if (options === undefined) {
      return t(key);
    }
    return t(key, options);
  };

  return {
    t: typedT,
    i18n,
    ready
  };
}

export { useTranslation } from 'react-i18next';

export type {
  CommonKeys,
  MenuKeys,
  NamespaceKeys,
  TranslationKeys,
  Translations
} from './translations';
