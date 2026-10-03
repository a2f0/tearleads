import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createAuthor } from "../../../test/helpers/documentFixturePrimitives";
import { sqlContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import { createRemoteDocument } from "./create";

// A folder whose create has not settled can carry a listed identity that
// adoption has not verified, or has refused. A document created in it would
// wrap its key to that identity's KEK, so its remote create waits.
test("a document create waits while its folder's create is pending", async () => {
  const { author } = await createAuthor();
  const keyPair = generateKemSeedAndKeyPair();
  let projectionReads = 0;
  let failures = 0;
  const { close, execSql } = await createTestExecSql(
    "document-create-pending-container",
  );
  try {
    await sqlContainerContentsPersistence.ensureSchema(execSql);
    await execSql(
      `INSERT INTO container_create_intents (
        id, container_id, parent_container_id, intent_type, sync_status,
        created_at, updated_at
      ) VALUES ('intent-1', 'pending-folder', 'parent', 'container.create',
        'pending', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
    );

    const created = await createRemoteDocument({
      apiClient: createMockApiClient({
        getContainerWriterProjectionResult: async () => {
          projectionReads += 1;
          throw new Error("no read while the folder's create is pending");
        },
      }),
      author,
      containerId: "pending-folder",
      execSql,
      onTerminalSubmitFailure: () => {
        failures += 1;
      },
      resolveProjectionUserKey: async () => null,
      targetSecretKey: keyPair.secretKey,
    });

    expect(created).toBeNull();
    expect(projectionReads).toBe(0);
    expect(failures).toBe(0);
  } finally {
    close();
  }
});
