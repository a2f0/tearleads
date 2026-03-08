export type OptionalWithUndefined<T> = {
  [K in keyof T]?: T[K] | undefined;
};
