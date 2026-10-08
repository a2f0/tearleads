import { expect, spyOn, test } from "bun:test";
import {
  DocumentPurgeProofResponseSchema,
  PrincipalPolicySnapshotPageResponseSchema,
} from "@tearleads/validators/response";
import { startPrincipalHistoryHttpProbe } from "../../../test/helpers/principalHistoryHttpProbe";
import { createLongPurgeHistoryFixture } from "../../../test/helpers/principalPurgeHistory";
import * as states from "../../access/read/principalStateStore";

for (const versions of [64, 128]) {
  test(`purge HTTP responses omit policy chains at ${versions} versions`, async () => {
    const fixture = await createLongPurgeHistoryFixture(versions);
    const server = startPrincipalHistoryHttpProbe();
    const fullHistory = spyOn(states, "listPrincipalStateHistory");
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        const response = await fetch(
          new URL(`/documents/${fixture.documentId}/purge`, server.url),
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${fixture.owner.token}`,
              "Content-Type": "application/json",
            },
            body: fixture.request,
            signal: AbortSignal.timeout(15_000),
          },
        );
        const text = await response.text();
        if (response.status === 202) {
          await Bun.sleep(10);
          continue;
        }
        expect(response.status, text).toBe(200);
        expect(text).not.toContain("previousStates");
        const proof = DocumentPurgeProofResponseSchema.parse(JSON.parse(text));
        expect(
          proof.policyEvidence.groups.map(({ head }) => head.version),
        ).toEqual([versions]);
        const bytes = new TextEncoder().encode(text).byteLength;
        expect(bytes).toBeLessThan(90_000);
        const retained = await fetch(
          new URL(`/documents/${fixture.documentId}/purge`, server.url),
          {
            headers: { Authorization: `Bearer ${fixture.owner.token}` },
            signal: AbortSignal.timeout(15_000),
          },
        );
        const retainedText = await retained.text();
        expect(retained.status, retainedText).toBe(200);
        expect(retainedText).not.toContain("previousStates");
        expect(new TextEncoder().encode(retainedText).byteLength).toBeLessThan(
          90_000,
        );
        for (const source of proof.policyEvidence.groups) {
          for (const afterVersion of [0, 32, versions - 1]) {
            const pageResponse = await fetch(
              new URL(
                `/principals/history?${new URLSearchParams({ grant: source.grant, afterVersion: String(afterVersion) })}`,
                server.url,
              ),
              {
                headers: { Authorization: `Bearer ${fixture.owner.token}` },
                signal: AbortSignal.timeout(15_000),
              },
            );
            expect(pageResponse.status, await pageResponse.clone().text()).toBe(
              200,
            );
            const page = PrincipalPolicySnapshotPageResponseSchema.parse(
              await pageResponse.json(),
            );
            expect(page.currentState.stateHash).toBe(source.head.stateHash);
            expect(page.previousStates.length).toBeLessThanOrEqual(32);
          }
        }
        expect(fullHistory).not.toHaveBeenCalled();
        expect(
          server.metrics.maximumDatabaseStatementsPerRequest,
        ).toBeLessThanOrEqual(350);
        return;
      }
      throw new Error("Purge preparation did not finish");
    } finally {
      fullHistory.mockRestore();
      await server.stop();
    }
  }, 30_000);
}
