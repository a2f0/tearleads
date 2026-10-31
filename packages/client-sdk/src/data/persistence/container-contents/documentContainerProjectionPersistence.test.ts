import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { SQLITE_BOUND_VARIABLE_BUDGET } from "../../sqlite/sqliteBindBudget";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { sqlDocumentContainerProjectionPersistence } from "./documentContainerProjectionPersistence";

/** Refuses any statement over SQLite's historical bind budget. */
function bindBudgetedExecSql(execSql: ExecSql): ExecSql {
  return new Proxy(execSql, {
    apply(target, thisArg, args) {
      const bind = args[1];
      const binds = Array.isArray(bind) ? bind.length : 0;
      if (binds > SQLITE_BOUND_VARIABLE_BUDGET)
        throw new Error(`SQLite bind limit exceeded: ${binds}`);
      return Reflect.apply(target, thisArg, args);
    },
  });
}

test("listLinkedContainerIdsByDocumentIds returns empty arrays for documents with no links", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-container-projection-test",
  );

  try {
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      execSql,
      [
        {
          containerIds: ["container-a", "container-b"],
          documentId: "document-with-links",
        },
      ],
    );

    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
        execSql,
        ["document-with-links", "document-without-links"],
      ),
    ).resolves.toEqual(
      new Map([
        ["document-with-links", ["container-a", "container-b"]],
        ["document-without-links", []],
      ]),
    );
  } finally {
    close();
  }
});

test("listDocumentIdsByContainerIds returns unique document ids linked to containers", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-container-projection-test",
  );

  try {
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      execSql,
      [
        {
          containerIds: ["container-a", "container-b"],
          documentId: "document-1",
        },
        {
          containerIds: ["container-b"],
          documentId: "document-2",
        },
        {
          containerIds: ["container-c"],
          documentId: "document-3",
        },
      ],
    );

    await expect(
      sqlDocumentContainerProjectionPersistence.listDocumentIdsByContainerIds(
        execSql,
        ["container-a", "container-b"],
      ),
    ).resolves.toEqual(["document-1", "document-2"]);
  } finally {
    close();
  }
});

test("replaceDocumentLinksBatch keeps the latest links for duplicate document ids", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-container-projection-test",
  );

  try {
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      execSql,
      [
        {
          containerIds: ["container-a"],
          documentId: "document-1",
        },
        {
          containerIds: ["container-b", "container-c"],
          documentId: "document-1",
        },
      ],
    );

    await expect(
      sqlDocumentContainerProjectionPersistence.listLinkedContainerIds(
        execSql,
        "document-1",
      ),
    ).resolves.toEqual(["container-b", "container-c"]);
  } finally {
    close();
  }
});

test("replaceDocumentLinksBatch keeps a page of multi-link documents within the bind budget", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-container-projection-bind-budget",
  );
  try {
    // A 100-document lane page with four links each binds 1,200 values in
    // one multi-row insert.
    const inputs = Array.from({ length: 100 }, (_, index) => ({
      containerIds: ["a", "b", "c", "d"].map((name) => `container-${name}`),
      documentId: `document-${String(index).padStart(3, "0")}`,
    }));
    const bounded = bindBudgetedExecSql(execSql);
    await sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
      bounded,
      inputs,
    );
    const linked =
      await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
        bounded,
        inputs.map((input) => input.documentId),
      );
    expect([...linked.values()].flat()).toHaveLength(400);
    expect(linked.get("document-099")).toEqual(inputs[99]?.containerIds);
  } finally {
    close();
  }
});
