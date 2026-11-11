/**
 * Reuses the current runtime-input group when every field of the freshly
 * constructed `next` literal is reference-equal, so unchanged groups keep a
 * stable identity across runtime reads.
 */
export function reuseIfShallowEqual<T extends object>(
  current: T | undefined,
  next: T,
): T {
  if (!current) {
    return next;
  }
  for (const key of Object.keys(next)) {
    if (Reflect.get(current, key) !== Reflect.get(next, key)) {
      return next;
    }
  }
  return current;
}
