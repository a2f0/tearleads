const lifetimes = new WeakMap<object, (() => boolean)[]>();

export function observeProjectionLifetime(
  context: object,
  current: () => boolean,
): void {
  const guards = lifetimes.get(context) ?? [];
  guards.push(current);
  lifetimes.set(context, guards);
}

export function projectionLifetimeGuard(
  context: object,
  current?: (() => boolean) | undefined,
): (() => boolean) | undefined {
  if (!lifetimes.has(context)) return current;
  return () =>
    current?.() !== false &&
    (lifetimes.get(context)?.every((guard) => guard()) ?? true);
}
