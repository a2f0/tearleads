import { expect, test } from "bun:test";
import { createNewerPolicyPurgeFixture } from "../../../test/helpers/documentPurgeNewerPolicies";
import { createVerifiedRemoteDocumentDeletionHandler } from "../../workflows/documents/purge";
import { loadDocumentPurgeCheckpoint } from "../persistence/documentPurgeCheckpointPersistence";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import { principalHistoryPrefixes } from "../sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../sqlite/principalHistoryStageSchema";

for (const mode of [
  "local",
  "online",
  "expired",
  "fork",
  "wrong-organization",
  "wrong-reference",
] as const) {
  test(`older purge connects to normally admitted newer policies: ${mode}`, async () => {
    const f = await createNewerPolicyPurgeFixture();
    let bridgeCurrent = true;
    const resolve = f.warmer.resolveReference;
    if (!resolve) throw new Error("Missing current-policy resolver");
    const purgeWarmer = Object.assign(
      async () => {
        throw new Error("Full policy read");
      },
      {
        resolveProjectionHistory: f.warmer.resolveProjectionHistory,
        resolveReference: async (request: Parameters<typeof resolve>[0]) => {
          const result = await resolve(request);
          return {
            ...result,
            organizationId:
              mode === "wrong-organization"
                ? "another-organization"
                : result.organizationId,
            policy:
              mode === "wrong-reference"
                ? (result.dependencies[0] ?? result.policy)
                : result.policy,
            stillCurrent: () => result.stillCurrent() && bridgeCurrent,
          };
        },
      },
    );
    try {
      for (const bundle of f.newer) {
        expect(
          await loadPrincipalPolicyCheckpoint(
            f.options.execSql,
            bundle.currentState.principalType,
            bundle.currentState.principalId,
          ),
        ).toMatchObject({
          version: 2,
          stateHash: bundle.currentState.stateHash,
        });
      }
      if (mode === "online") {
        const organization = f.newer[0];
        if (!organization) throw new Error("Missing organization fixture");
        f.policies.set(f.organizationId, await f.advance(organization));
        // Dispose cache progress, preserving durable trust. Authorized paging
        // must rebuild the ancestry instead of waiting forever for a cache hit.
        await f.db.delete(principalHistoryPrefixes).run();
        await f.db.delete(principalHistoryStages).run();
      } else {
        // A reader may have lost current membership after observing its pins.
        f.controls.failureStatus = 403;
      }
      const currentReads = f.requests.length;
      let deletions = 0;
      const handler = createVerifiedRemoteDocumentDeletionHandler({
        apiClient: { getDocumentPurgeProof: async () => f.fixture.proof },
        execSql: f.options.execSql,
        expectedOrganizationId: f.organizationId,
        resolveProjectionUserKey: f.fixture.resolveUserKey,
        warmReferencedPrincipalPolicies: purgeWarmer,
        onVerifiedDeletion: async ({ commitPurgeProof }) => {
          if (mode === "expired") bridgeCurrent = false;
          if (mode === "fork") {
            await f.options.execSql(
              "UPDATE principal_policy_checkpoints SET state_hash = ? WHERE principal_type = 'organization' AND principal_id = ?",
              ["f".repeat(64), f.organizationId],
            );
          }
          await commitPurgeProof(f.options.execSql);
          deletions++;
        },
      });
      const deletion = handler({ documentId: f.fixture.proof.documentId });
      if (mode === "local" || mode === "online") {
        await deletion;
        expect(deletions).toBe(1);
      } else {
        if (mode === "expired")
          await expect(deletion).rejects.toThrow("generation expired");
        else
          await expect(deletion).rejects.toMatchObject({
            code: mode === "fork" ? "equivocation" : "object_mismatch",
          });
        expect(deletions).toBe(0);
        expect(
          await loadDocumentPurgeCheckpoint(
            f.options.execSql,
            f.fixture.proof.documentId,
          ),
        ).toBeNull();
      }
      if (mode === "online")
        expect(f.requests.length).toBeGreaterThan(currentReads);
      else expect(f.requests).toHaveLength(currentReads);
      expect(f.incidents).toEqual([]);
      for (const bundle of f.newer) {
        const stateHash =
          mode === "fork" &&
          bundle.currentState.principalType === "organization"
            ? "f".repeat(64)
            : bundle.currentState.stateHash;
        expect(
          await loadPrincipalPolicyCheckpoint(
            f.options.execSql,
            bundle.currentState.principalType,
            bundle.currentState.principalId,
          ),
        ).toMatchObject({ version: 2, stateHash });
      }
    } finally {
      f.close();
    }
  });
}
