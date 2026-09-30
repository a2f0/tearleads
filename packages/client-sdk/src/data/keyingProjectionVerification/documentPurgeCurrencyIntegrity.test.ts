import { expect, test } from "bun:test";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { manifestBundle } from "../../../test/helpers/ancestorCitationScenario";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { createPurgeCurrencyFixture } from "../../../test/helpers/documentPurgeCurrency";
import { verifyContainerWriterProjection } from "./containerProjectionVerification";
import { verifyDocumentWriterProjection } from "./documentProjectionVerification";
import { verifyDocumentPurgeProof } from "./documentPurgeProofVerification";
import { runWithSecurityIncidentReporting } from "./error";

test("an older purge path does not conceal an invalid purge signature", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const { verification, advanceLater } = await createPurgeCurrencyFixture(
      execSql,
      0,
    );
    await advanceLater();
    const proof = structuredClone(verification.proof);
    Reflect.set(proof.purgeEvent.event, "signedAt", "2026-09-01T00:00:00.000Z");
    const incidents: unknown[] = [];
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        {
          operation: "document.purge",
          objectKind: "document",
          objectId: proof.documentId,
        },
        () => verifyDocumentPurgeProof({ ...verification, proof }),
      ),
    ).rejects.toMatchObject({ code: "signature_mismatch" });
    expect(incidents).toMatchObject([{ code: "signature_mismatch" }]);
  } finally {
    close();
  }
});

for (const objectKind of ["container", "document"] as const) {
  test(`an older purge ancestor does not conceal a same-epoch ${objectKind} fork`, async () => {
    const { execSql, close } = createNativeTestExecSql();
    try {
      const { verification, originalPath, advanceLater } =
        await createPurgeCurrencyFixture(execSql, 0);
      const leaf = originalPath.at(-1);
      if (!leaf) throw new Error("Expected authorization leaf");
      const alternative = await createMaterializedSyncFixture({
        organizationId: verification.expectedOrganizationId,
        containerId:
          objectKind === "container"
            ? leaf.state.containerId
            : "alternative-container",
        documentId:
          objectKind === "document"
            ? verification.expectedDocumentId
            : "alternative-document",
        userId: "alternative-writer",
      });
      if (objectKind === "container") {
        await verifyContainerWriterProjection({
          execSql,
          projection: alternative.projection,
          resolveUserKey: alternative.resolveProjectionUserKey,
        });
      } else {
        await verifyDocumentWriterProjection({
          execSql,
          projection: alternative.writerProjection,
          resolveUserKey: alternative.resolveProjectionUserKey,
        });
      }
      await advanceLater();
      const incidents: unknown[] = [];
      await expect(
        runWithSecurityIncidentReporting(
          async (error) => {
            incidents.push(error);
          },
          {
            operation: "document.purge",
            objectKind: "document",
            objectId: verification.expectedDocumentId,
          },
          () => verifyDocumentPurgeProof(verification),
        ),
      ).rejects.toMatchObject({ code: "equivocation" });
      expect(incidents).toMatchObject([{ code: "equivocation" }]);
    } finally {
      close();
    }
  });
}

test("a superseded purge path still rejects evidence newer than its declared head", async () => {
  const { execSql, close } = createNativeTestExecSql();
  try {
    const { verification, head, originalPath, advanceLater } =
      await createPurgeCurrencyFixture(execSql, 0);
    const leaf = originalPath.at(-1);
    if (!leaf) throw new Error("Expected authorization leaf");
    const proof = {
      ...verification.proof,
      documentManifestContainerPaths: [
        ...verification.proof.documentManifestContainerPaths,
        [head, leaf].map(manifestBundle),
      ],
    };
    await expect(
      verifyDocumentPurgeProof({ ...verification, proof }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    await advanceLater();
    await expect(
      verifyDocumentPurgeProof({ ...verification, proof }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
  } finally {
    close();
  }
});
