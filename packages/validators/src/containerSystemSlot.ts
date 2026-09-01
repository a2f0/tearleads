import { z } from "zod";
import { registerJsonSchemaFragment } from "./jsonSchema";

const CONTAINER_SYSTEM_SLOT_PATTERN = /^sys_v1_[A-Za-z0-9_-]{43}$/;

export function formatContainerSystemSlot(
  digest: Uint8Array,
): ContainerSystemSlot {
  if (digest.byteLength !== 32) {
    throw new Error("Container system slot digests must be exactly 32 bytes");
  }
  const encoded = btoa(String.fromCharCode(...digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `sys_v1_${encoded}`;
}

async function deriveOrganizationSystemSlot(input: {
  readonly namespace: string;
  readonly organizationId: string;
}): Promise<ContainerSystemSlot> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify({
        namespace: input.namespace,
        organizationId: input.organizationId,
        version: 1,
      }),
    ),
  );
  return formatContainerSystemSlot(new Uint8Array(digest));
}

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

export function deriveOrganizationRosterProfileContainerSystemSlot(input: {
  readonly organizationId: string;
}): Promise<ContainerSystemSlot> {
  return deriveOrganizationSystemSlot({
    namespace: "tearleads.organization-roster-profiles",
    organizationId: input.organizationId,
  });
}

export function deriveOrganizationMetadataContainerSystemSlot(input: {
  readonly organizationId: string;
}): Promise<ContainerSystemSlot> {
  return deriveOrganizationSystemSlot({
    namespace: "tearleads.organization-metadata",
    organizationId: input.organizationId,
  });
}
