import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateUniqueId(prefix?: string): string {
  const cryptoObj = globalThis.crypto;
  const randomPart =
    cryptoObj && typeof cryptoObj.randomUUID === 'function'
      ? cryptoObj.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return prefix ? `${prefix}-${randomPart}` : randomPart;
}
