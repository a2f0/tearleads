import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { captureStatements } from "../../../../test/helpers/statementCapture";
import { sqlContainerContentsPersistence as persistence } from "./containerContentsPersistence";
import { sqlDocumentMoveIntentPersistence } from "./documentMoveIntentPersistence";

const now = "2026-01-03T00:00:00.000Z";

for (const size of [1, 200]) {
  test(`removal repairs distinct null revisions across ${size} containers`, async () => {
    const db = await createTestExecSql("removal-null-revisions");
    try {
      await persistence.ensureSchema(db.execSql);
      // The schema permits null revision ids; lane + subject is the identity.
      // Both link-only intents have no surviving operations and must leave.
      for (const [subject, target] of [
        ["first", 0],
        ["last", size - 1],
      ] as const) {
        await db.execSql(
          `INSERT INTO local_intents (id, lane, intent_type, subject_id,
             local_id, target_container_id, sync_status, created_at, updated_at)
           VALUES (NULL, 'document.placement', 'document.link', ?, ?, ?, 'pending', ?, ?)`,
          [subject, subject, `container-${target}`, now, now],
        );
      }
      expect(await db.execSql("SELECT id FROM local_intents")).toEqual([
        { id: null },
        { id: null },
      ]);
      const removals = Array.from({ length: size }, (_, i) => ({
        containerId: `container-${i}`,
        reason: "deleted" as const,
        updatedAt: now,
      }));
      expect(await persistence.deleteContainers(db.execSql, removals)).toEqual(
        removals.map((row) => row.containerId),
      );
      expect(await db.execSql("SELECT subject_id FROM local_intents")).toEqual(
        [],
      );
    } finally {
      await db.close();
    }
  });
}

for (const discoveryOnly of [false, true]) {
  test(`one intent matching two batches is repaired once (discovery=${discoveryOnly})`, async () => {
    const db = await createTestExecSql("removal-duplicate-intent");
    const { execSql, statements } = captureStatements(db.execSql);
    try {
      await persistence.ensureSchema(execSql);
      await sqlDocumentMoveIntentPersistence.ensureSchema(execSql);
      await db.execSql(
        `INSERT INTO local_intents (id, lane, intent_type, subject_id,
           local_id, target_container_id, sync_status, created_at, updated_at)
         VALUES ('revision', 'document.placement', 'document.link', 'document',
           'local', 'container-0', 'pending', ?, ?)`,
        [now, now],
      );
      for (const id of ["container-0", "container-199", "survivor"]) {
        await db.execSql(
          "INSERT INTO document_intent_link_targets (intent_id, container_id) VALUES ('revision', ?)",
          [id],
        );
      }
      statements.length = 0;
      await persistence.deleteContainers(
        execSql,
        Array.from({ length: 200 }, (_, i) => ({
          containerId: `container-${i}`,
          reason: "deleted" as const,
          updatedAt: now,
        })),
        { discoveryOnly },
      );
      const intents = await db.execSql(
        "SELECT id, subject_id, target_container_id FROM local_intents",
      );
      expect(intents).toEqual([
        {
          id: expect.any(String),
          subject_id: "document",
          target_container_id: discoveryOnly ? "container-0" : "survivor",
        },
      ]);
      const revision = Reflect.get(intents[0] ?? {}, "id");
      if (typeof revision !== "string")
        throw new Error("Missing repaired revision");
      expect(revision).not.toBe("revision");
      expect(
        await db.execSql(
          "SELECT intent_id, container_id FROM document_intent_link_targets ORDER BY container_id",
        ),
      ).toEqual(
        (discoveryOnly
          ? ["container-0", "container-199", "survivor"]
          : ["survivor"]
        ).map((id) => ({ intent_id: revision, container_id: id })),
      );
      expect(
        statements.filter(({ sql }) => /^update "local_intents"/i.test(sql)),
      ).toHaveLength(1);
    } finally {
      await db.close();
    }
  });
}
