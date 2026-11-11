import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  readReplacementHolds,
  readReplacementLinks,
  replacementId,
  seedDocumentLinkReplacement,
} from "../../../../test/helpers/documentLinkReplacement";
import { captureStatements } from "../../../../test/helpers/statementCapture";
import { SQLITE_BOUND_VARIABLE_BUDGET } from "../../sqlite/sqliteBindBudget";
import { sqlDocumentContainerProjectionPersistence as links } from "./documentContainerProjectionPersistence";

for (const size of [999, 1001]) {
  test(`complete replacement bounds ${size} writable documents without changing protected links`, async () => {
    const db = await createTestExecSql("replacement-budget");
    const { execSql, statements } = captureStatements(db.execSql);
    try {
      const inputs = await seedDocumentLinkReplacement(execSql, size);
      const beforeHolds = await readReplacementHolds(db.execSql);
      const beforeIntents = await db.execSql("SELECT * FROM local_intents");
      const beforeDocuments = await db.execSql(
        "SELECT * FROM documents ORDER BY local_id",
      );
      statements.length = 0;
      await links.replaceDocumentLinksBatch(execSql, inputs);
      const latest = new Map(inputs.map((input) => [input.documentId, input]));
      const expected = Array.from(latest.values()).flatMap((input, index) =>
        (index >= size ? ["new", "old"] : [...new Set(input.containerIds)]).map(
          (containerId) => ({
            document_id: input.documentId,
            container_id: containerId,
          }),
        ),
      );
      expected.push({ document_id: "outside", container_id: "old" });
      expect(await readReplacementLinks(db.execSql)).toEqual(expected);
      expect(await readReplacementHolds(db.execSql)).toEqual(
        beforeHolds.filter(
          ({ document_id, container_id }) =>
            !latest
              .get(String(document_id))
              ?.containerIds.includes(String(container_id)) ||
            document_id === replacementId(size) ||
            document_id === replacementId(size + 1),
        ),
      );
      expect(await db.execSql("SELECT * FROM local_intents")).toEqual(
        beforeIntents,
      );
      expect(
        await db.execSql("SELECT * FROM documents ORDER BY local_id"),
      ).toEqual(beforeDocuments);
      const deletes = statements.filter(({ sql }) =>
        /^delete from "document_container_projection"/i.test(sql),
      );
      const inserts = statements.filter(({ sql }) =>
        /^insert into "document_container_projection"/i.test(sql),
      );
      expect(deletes.length).toBeGreaterThan(0);
      expect(inserts.length).toBeGreaterThan(0);
      expect(
        statements.findLastIndex(({ sql }) =>
          /^delete from "document_container_projection"/i.test(sql),
        ),
      ).toBeLessThan(
        statements.findIndex(({ sql }) =>
          /^insert into "document_container_projection"/i.test(sql),
        ),
      );
      expect(statements.filter(({ sql }) => /^begin/i.test(sql))).toHaveLength(
        1,
      );
      expect(statements.filter(({ sql }) => /^commit/i.test(sql))).toHaveLength(
        1,
      );
      expect(
        Math.max(...statements.map(({ binds }) => binds)),
      ).toBeLessThanOrEqual(SQLITE_BOUND_VARIABLE_BUDGET);
    } finally {
      db.close();
    }
  });
}
