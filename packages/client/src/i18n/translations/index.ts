import { en } from './en';
import { es } from './es';
import { pt } from './pt';
import { ua } from './ua';

export const translations = {
  en,
  es,
  pt,
  ua
} as const;

export type SupportedLanguage = keyof typeof translations;

export * from './types';
