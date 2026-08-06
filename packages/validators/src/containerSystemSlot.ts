import { z } from "zod";
import { registerJsonSchemaFragment } from "./jsonSchema";

const CONTAINER_SYSTEM_SLOT_PATTERN = /^sys_v1_[A-Za-z0-9_-]{43}$/;

export const ContainerSystemSlotSchema = registerJsonSchemaFragment(
  z.custom<string>(
    (value) =>
      typeof value === "string" && CONTAINER_SYSTEM_SLOT_PATTERN.test(value),
  ),
  {
    pattern: CONTAINER_SYSTEM_SLOT_PATTERN.source,
    type: "string",
  },
);

export type ContainerSystemSlot = z.infer<typeof ContainerSystemSlotSchema>;

export function isContainerSystemSlot(
  value: unknown,
): value is ContainerSystemSlot {
  return ContainerSystemSlotSchema.safeParse(value).success;
}

export function isNullableContainerSystemSlot(
  value: unknown,
): value is ContainerSystemSlot | null {
  return value === null || isContainerSystemSlot(value);
}
