import { en } from './en';
import { es } from './es';
import { ua } from './ua';

export const translations = {
  en,
  es,
  ua
} as const;

export type SupportedLanguage = keyof typeof translations;

export { en, es, ua };
export * from './types';
