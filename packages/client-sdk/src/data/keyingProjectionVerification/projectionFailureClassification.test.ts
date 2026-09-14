import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createParentProjection } from "../../../test/helpers/containerFixtures";
import { createMaterializedSyncFixture } from "../../../test/helpers/documentFixtures";
import { assertDocumentWriterProjectionConsistent } from "../documents/shared/projection";
import { verifyContainerWriterProjection } from "./containerProjectionVerification";
import { verifyDocumentWriterProjectionAuthorization } from "./documentProjectionVerification";
import { runWithSecurityIncidentReporting } from "./error";

// A typed runtime failure inside a verification pass is a defect or an
// infrastructure fault, not evidence about the received projection. It must
// reach the caller unchanged instead of being recorded as an invalid shape.
const defect = new TypeError("Cannot read properties of undefined");

test("a container projection defect propagates without an incident", async () => {
  const fixture = await createParentProjection();
  const { close, execSql } = await createTestExecSql(
    "container-projection-defect",
  );
  const incidents: unknown[] = [];
  try {
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        {
          operation: "container.verify",
          objectKind: "container",
          objectId: fixture.projection.containerId,
        },
        () =>
          verifyContainerWriterProjection({
            execSql,
            projection: fixture.projection,
            resolveUserKey: async () => {
              throw defect;
            },
          }),
      ),
    ).rejects.toBe(defect);
    expect(incidents).toEqual([]);
  } finally {
    close();
  }
});

test("a document projection defect propagates without an incident", async () => {
  const fixture = await createMaterializedSyncFixture();
  const { close, execSql } = await createTestExecSql(
    "document-projection-defect",
  );
  const incidents: unknown[] = [];
  const reporter = async (error: unknown) => {
    incidents.push(error);
  };
  const context = {
    operation: "document.verify",
    objectKind: "document" as const,
    objectId: fixture.writerProjection.documentId,
  };
  try {
    await expect(
      runWithSecurityIncidentReporting(reporter, context, () =>
        verifyDocumentWriterProjectionAuthorization({
          execSql,
          projection: fixture.writerProjection,
          resolveUserKey: async () => {
            throw defect;
          },
        }),
      ),
    ).rejects.toBe(defect);
    await expect(
      runWithSecurityIncidentReporting(reporter, context, () =>
        assertDocumentWriterProjectionConsistent(fixture.writerProjection, {
          execSql,
          resolveProjectionUserKey: async () => {
            throw defect;
          },
        }),
      ),
    ).rejects.toBe(defect);
    expect(incidents).toEqual([]);
  } finally {
    close();
  }
});
