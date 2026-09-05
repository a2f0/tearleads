import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "../../../test/helpers/waitFor";
import { defaultDocumentProjectorRegistry } from "../../data/documents/documentKinds";
import { createDomainScope } from "../../data/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../../workflows/container-contents/containerPersistence";
import {
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "../../workflows/documents";
import { createContainerContentsStore } from "../container-contents/containerContentsStore";
import { createContainerContentsTestRuntime } from "../container-contents/runtime.testFixtures";
import { createLocalProjectionStore } from "./localProjectionStore";

async function seed(
  execSql: ExecSql,
  title: string,
  containerId = "root",
  id = "note",
) {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await defaultContainerContentsPersistence.saveContainer(
    execSql,
    {
      effectiveAccessLevel: "admin",
      icon: null,
      id: containerId,
      metadataDocumentId: null,
      name: "/",
      organizationId: "org",
      parentId: null,
    },
    null,
  );
  await defaultDocumentsPersistence.ensureSchema(execSql);
  await defaultDocumentsPersistence.saveDocument(execSql, {
    accessEpoch: 1,
    accessStateHash: null,
    containerId,
    contentKeyBundle: null,
    documentId: null,
    documentKekTargets: null,
    documentKind: "note",
    documentManifestBundle: null,
    id,
    lastCommitLsn: null,
    snapshotEndVersion: "",
    text: title,
    title,
  });
}

function createView(execSql: ExecSql) {
  const runtime = createContainerContentsTestRuntime({
    domainScope: createDomainScope(),
    execSql,
    online: false,
  });
  const containerStore = createContainerContentsStore(runtime);
  const view = createLocalProjectionStore({ containerStore, runtime });
  view.updateRuntime(runtime);
  return { runtime, view };
}

test.each([
  "root",
  "other",
])("autosaves in %s publish local reads before a pending trailing refresh", async (containerId) => {
  const db = await createTestExecSql(`projection-autosaves-${containerId}`);
  const releases: Array<() => void> = [];
  const delayed = new Proxy(db.execSql, {
    apply: async (target, _receiver, args: Parameters<ExecSql>) => {
      const rows = await target(...args);
      if (
        args[0].startsWith("select") &&
        args[0].includes('from "document_projection"')
      ) {
        await new Promise<void>((resolve) => releases.push(resolve));
      }
      return rows;
    },
  });
  try {
    await seed(db.execSql, "Cached");
    const { view } = createView(delayed);
    await waitFor(() => view.getSnapshot().ready, "Tree did not hydrate");
    view.setActiveContainer("root");
    const title = () =>
      view.getSnapshot().documentSummariesByContainerId.get("root")?.[0]?.title;
    const id = containerId === "root" ? "note" : "other-note";
    for (let index = 0; index < 2; index += 1) {
      await waitFor(
        () => releases.length === index + 1,
        "Local summary read was not held",
      );
      await seed(db.execSql, `Autosave ${index}`, containerId, id);
      view.refreshPersistedDocument({
        id,
        containerId,
        documentId: null,
        title: `Autosave ${index}`,
        updatedAt: `2026-09-05T00:00:0${index}.000Z`,
      });
      releases[index]?.();
      await waitFor(
        () => releases.length === index + 2,
        "Trailing read was not scheduled",
      );
      expect(title()).toBe(
        containerId === "root" && index === 1 ? "Autosave 0" : "Cached",
      );
    }
    releases[2]?.();
    await waitFor(
      () => title() === (containerId === "root" ? "Autosave 1" : "Cached"),
      "Trailing refresh did not converge",
    );
  } finally {
    for (const release of releases) {
      release();
    }
    await Promise.resolve();
    db.close();
  }
});

test("a cached row deleted during first local hydration cannot reappear from the stale read", async () => {
  const db = await createTestExecSql("projection-deletion-during-read");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let settled = false;
  const delayed = new Proxy(db.execSql, {
    apply: async (target, _receiver, args: Parameters<ExecSql>) => {
      const rows = await target(...args);
      if (
        !held &&
        args[0].startsWith("select") &&
        args[0].includes('from "document_projection"')
      ) {
        held = true;
        await gate;
        settled = true;
      }
      return rows;
    },
  });
  try {
    await seed(db.execSql, "Deleted offline");
    const { view } = createView(delayed);
    await waitFor(() => view.getSnapshot().ready, "Tree did not hydrate");
    view.setActiveContainer("root");
    await waitFor(() => held, "No local summary read was held");
    await deletePersistedDocument({
      documentProjectors: defaultDocumentProjectorRegistry,
      execSql: db.execSql,
      localId: "note",
      persistence: defaultDocumentsPersistence,
    });
    view.removePersistedDocument("note");
    let resurrected = false;
    view.subscribe(() => {
      resurrected ||=
        (view.getSnapshot().documentSummariesByContainerId.get("root")
          ?.length ?? 0) > 0;
    });
    release();
    await waitFor(
      () =>
        settled &&
        view.getSnapshot().documentSummariesByContainerId.has("root"),
      "Replacement local read did not finish",
    );
    expect(resurrected).toBe(false);
    expect(
      view.getSnapshot().documentSummariesByContainerId.get("root"),
    ).toEqual([]);
  } finally {
    release();
    db.close();
  }
});

test("replacing a ready database adapter reloads cached summaries without requiring an offline reset", async () => {
  const first = await createTestExecSql("projection-first-adapter");
  const second = await createTestExecSql("projection-second-adapter");
  try {
    await seed(first.execSql, "First database");
    await seed(second.execSql, "Replacement database");
    const { runtime, view } = createView(first.execSql);
    view.setActiveContainer("root");
    const title = () =>
      view.getSnapshot().documentSummariesByContainerId.get("root")?.[0]?.title;
    await waitFor(
      () => title() === "First database",
      "First database did not hydrate",
    );
    view.updateRuntime({
      ...runtime,
      infra: { ...runtime.infra, execSql: second.execSql },
    });
    await waitFor(
      () => title() === "Replacement database",
      "New adapter retained the previous database's summaries",
    );
  } finally {
    first.close();
    second.close();
  }
});

test("link and access-only changes publish a new local projection snapshot", async () => {
  const db = await createTestExecSql("projection-link-and-access-delta");
  try {
    const { view } = createView(db.execSql);
    const summary = {
      id: "note",
      documentId: "remote-note",
      containerId: "root",
      title: "Cached",
      updatedAt: "2026-09-05T00:00:00.000Z",
      effectiveAccessLevel: "admin" as const,
    };
    view.applyReconciled({
      containerId: "root",
      documentSummaries: [summary],
      linkedContainerIdsByDocumentId: new Map([["remote-note", ["root"]]]),
    });
    let notifications = 0;
    view.subscribe(() => {
      notifications += 1;
    });
    view.applyReconciled({
      containerId: "root",
      documentSummaries: [summary],
      linkedContainerIdsByDocumentId: new Map([
        ["remote-note", ["root", "shared"]],
      ]),
    });
    expect(
      view.getSnapshot().linkedContainerIdsByDocumentId.get("remote-note"),
    ).toEqual(["root", "shared"]);
    expect(notifications).toBe(1);
    view.applyReconciled({
      containerId: "root",
      documentSummaries: [{ ...summary, effectiveAccessLevel: "read" }],
    });
    expect(
      view.getSnapshot().documentSummariesByContainerId.get("root")?.[0]
        ?.effectiveAccessLevel,
    ).toBe("read");
    expect(notifications).toBe(2);
    await waitFor(
      () => view.getSnapshot().ready,
      "Local initialization did not settle",
    );
  } finally {
    db.close();
  }
});
