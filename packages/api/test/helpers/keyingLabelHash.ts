import { computeKeyingDomainHash } from "@tearleads/crypto";

/** A keying-domain hash of a fixture label, for fake manifest and event fields. */
export async function hashOf(label: string): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", {
    label,
  });
}
