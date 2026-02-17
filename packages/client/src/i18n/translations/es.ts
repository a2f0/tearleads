import { esPart1 } from './es/part1';
import { esPart2 } from './es/part2';
import { esPart3 } from './es/part3';
import { esPart4 } from './es/part4';
import type { I18NextTranslations } from './types';

export const es = {
  ...esPart1,
  ...esPart2,
  ...esPart3,
  ...esPart4
} as const satisfies I18NextTranslations;
