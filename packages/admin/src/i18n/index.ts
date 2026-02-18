import { useTranslation } from 'react-i18next';

export function useTypedTranslation(namespace?: string) {
  const { t, i18n, ready } = useTranslation(namespace);
  return { t, i18n, ready };
}
