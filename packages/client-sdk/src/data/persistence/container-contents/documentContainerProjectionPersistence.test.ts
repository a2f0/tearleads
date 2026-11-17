import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { SQLITE_BOUND_VARIABLE_BUDGET } from "../../sqlite/sqliteBindBudget";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { DocumentContainerProjectionRepository as Links } from "./documentContainerProjectionPersistence";

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
    await new Links(execSql).replaceDocumentLinksBatch([
      {
        containerIds: ["container-a", "container-b"],
        documentId: "document-with-links",
      },
    ]);

    await expect(
      new Links(execSql).listLinkedContainerIdsByDocumentIds([
        "document-with-links",
        "document-without-links",
      ]),
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
    await new Links(execSql).replaceDocumentLinksBatch([
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
    ]);

    await expect(
      new Links(execSql).listDocumentIdsByContainerIds([
        "container-a",
        "container-b",
      ]),
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
    await new Links(execSql).replaceDocumentLinksBatch([
      {
        containerIds: ["container-a"],
        documentId: "document-1",
      },
      {
        containerIds: ["container-b", "container-c"],
        documentId: "document-1",
      },
    ]);

    await expect(
      new Links(execSql).listLinkedContainerIds("document-1"),
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
    await new Links(bounded).replaceDocumentLinksBatch(inputs);
    const linked = await new Links(bounded).listLinkedContainerIdsByDocumentIds(
      inputs.map((input) => input.documentId),
    );
    expect([...linked.values()].flat()).toHaveLength(400);
    expect(linked.get("document-099")).toEqual(inputs[99]?.containerIds);
  } finally {
    close();
  }
});

test("link rows carry the repository clock for single and batch replacements", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-container-projection-clock",
  );
  const updatedAt = async (documentId: string) =>
    (
      await execSql(
        "SELECT updated_at FROM document_container_projection WHERE document_id = ? ORDER BY container_id",
        [documentId],
      )
    ).map(({ updated_at: stamp }) => stamp);

  try {
    const single = new Date("2026-01-02T03:04:05.000Z");
    await new Links(execSql, () => single).replaceDocumentLinks("document-1", [
      "container-a",
      "container-b",
    ]);
    expect(await updatedAt("document-1")).toEqual([
      single.toISOString(),
      single.toISOString(),
    ]);

    const batch = new Date("2026-02-03T04:05:06.000Z");
    await new Links(execSql, () => batch).replaceDocumentLinksBatch([
      { containerIds: ["container-a"], documentId: "document-1" },
      { containerIds: ["container-c"], documentId: "document-2" },
    ]);
    expect(await updatedAt("document-1")).toEqual([batch.toISOString()]);
    expect(await updatedAt("document-2")).toEqual([batch.toISOString()]);
  } finally {
    close();
  }
});
