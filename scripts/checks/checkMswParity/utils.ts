import fs from 'node:fs/promises';
import type { HttpMethod } from './types.ts';

export const toMethod = (value: string): HttpMethod => {
  const upper = value.toUpperCase();
  if (
    upper === 'GET' ||
    upper === 'POST' ||
    upper === 'PUT' ||
    upper === 'PATCH' ||
    upper === 'DELETE'
  ) {
    return upper;
  }

  throw new Error(`Unsupported HTTP method: ${value}`);
};

export const pathExists = async (candidatePath: string): Promise<boolean> => {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
};
