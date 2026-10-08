import { expect } from "bun:test";
import type { TestUser } from "@tearleads/bob-and-alice";
import {
  DocumentPurgeProofResponseSchema,
  PrincipalPolicySnapshotPageResponseSchema,
} from "@tearleads/validators/response";
import { requestPreparedPrincipalPolicy } from "./principalHistoryRequest";

export async function assertPurgePolicyPages(
  response: Response,
  reader: TestUser,
) {
  const proof = DocumentPurgeProofResponseSchema.parse(await response.json());
  expect(proof).not.toHaveProperty("principalPolicySnapshots");
  for (const source of [
    proof.policyEvidence.organization,
    ...proof.policyEvidence.groups,
  ]) {
    if (!source) continue;
    const page = await requestPreparedPrincipalPolicy(
      `/principals/history?${new URLSearchParams({ grant: source.grant })}`,
      {
        headers: { Authorization: `Bearer ${reader.token}` },
      },
    );
    expect(page.status, await page.clone().text()).toBe(200);
    const body = PrincipalPolicySnapshotPageResponseSchema.parse(
      await page.json(),
    );
    expect(body.currentState.stateHash).toBe(source.head.stateHash);
    expect(body.previousStates.length).toBeLessThanOrEqual(32);
  }
  return proof;
}
