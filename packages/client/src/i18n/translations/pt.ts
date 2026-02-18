import { ptPart1 } from './pt/part1';
import { ptPart2 } from './pt/part2';
import { ptPart3 } from './pt/part3';
import { ptPart4 } from './pt/part4';
import type { I18NextTranslations } from './types';

export const pt = {
  ...ptPart1,
  ...ptPart2,
  ...ptPart3,
  ...ptPart4
} as const satisfies I18NextTranslations;
