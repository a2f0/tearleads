const CONTAINER_SYSTEM_SLOT_PATTERN = /^sys_v1_[A-Za-z0-9_-]{43}$/;

export type ContainerSystemSlot = string;

export function isContainerSystemSlot(
  value: unknown,
): value is ContainerSystemSlot {
  return typeof value === "string" && CONTAINER_SYSTEM_SLOT_PATTERN.test(value);
}

export function isNullableContainerSystemSlot(
  value: unknown,
): value is ContainerSystemSlot | null {
  return value === null || isContainerSystemSlot(value);
}
