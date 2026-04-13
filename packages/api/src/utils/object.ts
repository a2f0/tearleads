export function assignIfDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value === undefined) {
    return;
  }

  target[key] = value;
}
