import { enPart1 } from './en/part1';
import { enPart2 } from './en/part2';
import { enPart3 } from './en/part3';
import { enPart4 } from './en/part4';
import type { I18NextTranslations } from './types';

export const en = {
  ...enPart1,
  ...enPart2,
  ...enPart3,
  ...enPart4
} as const satisfies I18NextTranslations;
