export const CONTACTS_CONTAINER_BUILTIN_KIND = "contacts" as const;

export const CONTAINER_BUILTIN_KINDS = [
  CONTACTS_CONTAINER_BUILTIN_KIND,
] as const;

export type ContainerBuiltinKind = (typeof CONTAINER_BUILTIN_KINDS)[number];

export function isContainerBuiltinKind(
  value: unknown,
): value is ContainerBuiltinKind {
  return value === CONTACTS_CONTAINER_BUILTIN_KIND;
}

export function isNullableContainerBuiltinKind(
  value: unknown,
): value is ContainerBuiltinKind | null {
  return value === null || isContainerBuiltinKind(value);
}
