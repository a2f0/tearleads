import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  readReplacementHolds,
  readReplacementLinks,
  replacementId,
  seedDocumentLinkReplacement,
} from "../../../../test/helpers/documentLinkReplacement";
import { captureStatements } from "../../../../test/helpers/statementCapture";
import { sqlDocumentContainerProjectionPersistence as links } from "./documentContainerProjectionPersistence";

for (const moveIntentId of ["other-move", "owned-move"]) {
  test(`large replacement only releases placements owned by ${moveIntentId}`, async () => {
    const db = await createTestExecSql("replacement-owned-move");
    const { execSql, statements } = captureStatements(db.execSql);
    try {
      const inputs = await seedDocumentLinkReplacement(execSql, 1001);
      const beforeLinks = await readReplacementLinks(db.execSql);
      const beforeHolds = await readReplacementHolds(db.execSql);
      const beforeIntents = await db.execSql("SELECT * FROM local_intents");
      statements.length = 0;
      await links.replaceDocumentLinksBatch(execSql, inputs, { moveIntentId });
      const owned = moveIntentId === "owned-move";
      expect(await readReplacementLinks(db.execSql)).toEqual(
        beforeLinks.filter(
          ({ document_id, container_id }) =>
            !owned ||
            document_id !== replacementId(1001) ||
            container_id === "new",
        ),
      );
      expect(await readReplacementHolds(db.execSql)).toEqual(
        beforeHolds.filter(
          ({ document_id }) => !owned || document_id !== replacementId(1001),
        ),
      );
      expect(await db.execSql("SELECT * FROM local_intents")).toEqual(
        beforeIntents,
      );
      expect(
        statements.filter(({ sql }) =>
          /^delete from "document_container_projection"/i.test(sql),
        ),
      ).toHaveLength(owned ? 1 : 0);
    } finally {
      db.close();
    }
  });
}

test("a stale generation rolls back every replacement batch and released hold", async () => {
  const db = await createTestExecSql("replacement-generation-rollback");
  const { execSql, statements } = captureStatements(db.execSql);
  try {
    const inputs = await seedDocumentLinkReplacement(execSql, 1001);
    const beforeLinks = await readReplacementLinks(db.execSql);
    const beforeHolds = await readReplacementHolds(db.execSql);
    statements.length = 0;
    let guardCalls = 0;
    await links.replaceDocumentLinksBatch(execSql, inputs, {
      stillCurrent() {
        guardCalls += 1;
        // Refuse at commit, after the final batch, not before reaching it.
        expect(
          statements
            .filter(({ sql }) =>
              /^delete from "document_container_projection"/i.test(sql),
            )
            .map(({ binds }) => binds),
        ).toEqual([999, 2]);
        expect(
          statements.filter(({ sql }) =>
            /^insert into "document_container_projection"/i.test(sql),
          ),
        ).toHaveLength(4);
        return false;
      },
    });
    expect(guardCalls).toBe(1);
    expect(await readReplacementLinks(db.execSql)).toEqual(beforeLinks);
    expect(await readReplacementHolds(db.execSql)).toEqual(beforeHolds);
    expect(statements.filter(({ sql }) => /^rollback/i.test(sql))).toHaveLength(
      1,
    );
    expect(statements.filter(({ sql }) => /^commit/i.test(sql))).toHaveLength(
      0,
    );
  } finally {
    db.close();
  }
});

test("an insertion failure rolls back earlier replacement batches and holds", async () => {
  const db = await createTestExecSql("replacement-insert-rollback");
  const { execSql, statements } = captureStatements(db.execSql);
  try {
    const inputs = await seedDocumentLinkReplacement(execSql, 1001);
    const beforeLinks = await readReplacementLinks(db.execSql);
    const beforeHolds = await readReplacementHolds(db.execSql);
    await db.execSql(`CREATE TRIGGER fail_last_replacement BEFORE INSERT ON document_container_projection
      WHEN NEW.document_id = 'document-0999'
      BEGIN SELECT RAISE(ABORT, 'replacement insertion rejected'); END`);
    statements.length = 0;
    await expect(
      links.replaceDocumentLinksBatch(execSql, inputs),
    ).rejects.toThrow();
    expect(
      statements
        .filter(({ sql }) =>
          /^delete from "document_container_projection"/i.test(sql),
        )
        .map(({ binds }) => binds),
    ).toEqual([999, 2]);
    expect(
      statements.filter(({ sql }) =>
        /^insert into "document_container_projection"/i.test(sql),
      ),
    ).toHaveLength(4);
    expect(await readReplacementLinks(db.execSql)).toEqual(beforeLinks);
    expect(await readReplacementHolds(db.execSql)).toEqual(beforeHolds);
    expect(statements.filter(({ sql }) => /^rollback/i.test(sql))).toHaveLength(
      1,
    );
    expect(statements.filter(({ sql }) => /^commit/i.test(sql))).toHaveLength(
      0,
    );
  } finally {
    db.close();
  }
});
