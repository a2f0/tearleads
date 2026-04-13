type WithoutUndefinedValues<T extends Record<string, unknown>> = {
  [K in keyof T as Exclude<T[K], undefined> extends never
    ? never
    : K]?: Exclude<T[K], undefined>;
};

export function omitUndefinedValues<T extends Record<string, unknown>>(
  input: T,
): WithoutUndefinedValues<T> {
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }

    next[key] = value;
  }

  return next as WithoutUndefinedValues<T>;
}
