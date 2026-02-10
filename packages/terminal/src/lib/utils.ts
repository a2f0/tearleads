type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ClassValue[]
  | Record<string, boolean>;

function toClassName(input: ClassValue): string {
  if (!input) {
    return '';
  }

  if (typeof input === 'string' || typeof input === 'number') {
    return String(input);
  }

  if (Array.isArray(input)) {
    return input.map((value) => toClassName(value)).filter(Boolean).join(' ');
  }

  return Object.entries(input)
    .filter(([, enabled]) => enabled)
    .map(([className]) => className)
    .join(' ');
}

export function cn(...inputs: ClassValue[]): string {
  return inputs.map((value) => toClassName(value)).filter(Boolean).join(' ');
}
