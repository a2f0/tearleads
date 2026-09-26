import { expect } from "bun:test";
import type { ProjectionPolicyEvidenceResponse } from "@tearleads/validators/response";

/** Inspect API-served objects, including fields that loose schemas would allow. */
export function expectPublicProjectionPolicyEvidence(
  evidence: ProjectionPolicyEvidenceResponse,
) {
  expect(evidence.organization).not.toBeNull();
  for (const group of [evidence.organization, ...evidence.groups]) {
    if (!group) throw new Error("Expected organization policy snapshot");
    expect(Object.keys(group).sort()).toEqual([
      "currentGrants",
      "currentProjection",
      "currentState",
      "previousStates",
    ]);
    for (const predecessor of group.previousStates)
      expect(Object.keys(predecessor).sort()).toEqual([
        "grants",
        "projection",
        "state",
      ]);
  }
}
