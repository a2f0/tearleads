import { expect } from "bun:test";
import type { ProjectionPolicyEvidenceResponse } from "@tearleads/validators/response";

/** Inspect API-served objects, including fields that loose schemas would allow. */
export function expectPublicProjectionPolicyEvidence(
  evidence: ProjectionPolicyEvidenceResponse,
) {
  expect(evidence.organization).not.toBeNull();
  for (const group of [evidence.organization, ...evidence.groups]) {
    if (!group) throw new Error("Expected organization policy snapshot");
    expect(Object.keys(group).sort()).toEqual(["grant", "head"]);
    expect(group.grant.length).toBeGreaterThan(0);
    expect(group.grant.length).toBeLessThanOrEqual(4096);
  }
}
