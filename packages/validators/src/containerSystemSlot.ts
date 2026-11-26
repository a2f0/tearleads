import { sha256 } from "@noble/hashes/sha2.js";
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

export const ORGANIZATION_TRASH_SLOT_NAMESPACE = "tearleads.organization-trash";

export function deriveOrganizationSystemSlot(input: {
  readonly namespace: string;
  readonly organizationId: string;
}): ContainerSystemSlot {
  const label = JSON.stringify({
    namespace: input.namespace,
    organizationId: input.organizationId,
    version: 1,
  });
  return formatContainerSystemSlot(sha256(new TextEncoder().encode(label)));
}

export function deriveOrganizationTrashSystemSlot(
  organizationId: string,
): ContainerSystemSlot {
  return deriveOrganizationSystemSlot({
    namespace: ORGANIZATION_TRASH_SLOT_NAMESPACE,
    organizationId,
  });
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

/**
 * The slot of an organization's roster profile container, whose documents
 * are the ones a document listing never serves.
 */
export function organizationRosterProfileContainerSystemSlot(
  organizationId: string,
): ContainerSystemSlot {
  return deriveOrganizationSystemSlot({
    namespace: "tearleads.organization-roster-profiles",
    organizationId,
  });
}

export async function deriveOrganizationRosterProfileContainerSystemSlot(input: {
  readonly organizationId: string;
}): Promise<ContainerSystemSlot> {
  return organizationRosterProfileContainerSystemSlot(input.organizationId);
}

export async function deriveOrganizationMetadataContainerSystemSlot(input: {
  readonly organizationId: string;
}): Promise<ContainerSystemSlot> {
  return deriveOrganizationSystemSlot({
    namespace: "tearleads.organization-metadata",
    organizationId: input.organizationId,
  });
}
