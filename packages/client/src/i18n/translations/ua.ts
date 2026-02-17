import type { I18NextTranslations } from './types';
import { uaPart1 } from './ua/part1';
import { uaPart2 } from './ua/part2';
import { uaPart3 } from './ua/part3';
import { uaPart4 } from './ua/part4';

export const ua = {
  ...uaPart1,
  ...uaPart2,
  ...uaPart3,
  ...uaPart4
} as const satisfies I18NextTranslations;
