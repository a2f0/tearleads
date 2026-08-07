export function defineFacadeKeys<Facade extends object>() {
  return <Keys extends ReadonlyArray<keyof Facade>>(
    keys: Exclude<keyof Facade, Keys[number]> extends never ? Keys : never,
  ): Keys => keys;
}

export function projectFacade<Facade extends object, Key extends keyof Facade>(
  facade: Facade,
  keys: ReadonlyArray<Key>,
): Pick<Facade, Key>;
export function projectFacade(
  facade: object,
  keys: ReadonlyArray<PropertyKey>,
): object {
  const projected = {};
  for (const key of keys) {
    Reflect.set(projected, key, Reflect.get(facade, key, facade));
  }
  return projected;
}

export function projectBoundFacade<
  Facade extends object,
  Key extends keyof Facade,
>(facade: Facade, keys: ReadonlyArray<Key>): Pick<Facade, Key>;
export function projectBoundFacade(
  facade: object,
  keys: ReadonlyArray<PropertyKey>,
): object {
  const projected = {};
  for (const key of keys) {
    const value = Reflect.get(facade, key, facade);
    Reflect.set(
      projected,
      key,
      typeof value === "function" ? value.bind(facade) : value,
    );
  }
  return projected;
}
