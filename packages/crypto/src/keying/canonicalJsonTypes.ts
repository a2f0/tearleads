/** Security-boundary contracts for untrusted key data and verified outputs. */
type CanonicalJsonPrimitive = boolean | number | string | null;

export type KeyingCanonicalJson =
  | CanonicalJsonPrimitive
  | readonly KeyingCanonicalJson[]
  | { readonly [key: string]: KeyingCanonicalJson };

export type KeyingCanonicalPayload<T> = T extends CanonicalJsonPrimitive
  ? T
  : T extends readonly (infer Item)[]
    ? readonly KeyingCanonicalPayload<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: KeyingCanonicalPayload<T[Key]> }
      : never;
