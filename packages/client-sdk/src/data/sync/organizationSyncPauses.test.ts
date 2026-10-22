import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDomainScope } from "../shared/domainScope";
import {
  getOrCreateOrganizationSyncPauses,
  isPauseRemovedDocument,
  isRetainedWhileSyncPaused,
  recordPauseRemovedDocument,
} from "./organizationSyncPauses";

const METADATA_SLOT = `sys_v1_${"m".repeat(43)}`;

test("a replaced pause set persists for a later scope on the same database", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-sync-pauses",
  );
  try {
    const first = getOrCreateOrganizationSyncPauses(createDomainScope());
    expect(await first.replace(execSql, ["org-b", "org-a"])).toEqual({
      paused: ["org-a", "org-b"],
      resumed: [],
    });
    expect(await first.replace(execSql, ["org-b", "org-c"])).toEqual({
      paused: ["org-c"],
      resumed: ["org-a"],
    });
    expect(await first.replace(execSql, ["org-c", "org-b"])).toEqual({
      paused: [],
      resumed: [],
    });

    const reopened = getOrCreateOrganizationSyncPauses(createDomainScope());
    expect(reopened.isOrganizationPaused("org-b")).toBe(false);
    await reopened.load(execSql);
    expect([...reopened.pausedOrganizationIds()].sort()).toEqual([
      "org-b",
      "org-c",
    ]);
  } finally {
    close();
  }
});

test("skips a paused organization's containers except its metadata root", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-sync-pauses-containers",
  );
  try {
    const pauses = getOrCreateOrganizationSyncPauses(createDomainScope());
    await pauses.replace(execSql, ["paused"]);
    const metadataRoot = {
      organizationId: "paused",
      parentId: null,
      systemSlot: METADATA_SLOT,
    };

    expect(isRetainedWhileSyncPaused(metadataRoot)).toBe(true);
    const pausedRoot = { organizationId: "paused", parentId: null };
    expect(pauses.isContainerPaused(metadataRoot, null)).toBe(false);
    expect(pauses.isContainerPaused(pausedRoot, null)).toBe(true);
    expect(
      pauses.isContainerPaused(
        {
          organizationId: "paused",
          parentId: "root",
          systemSlot: METADATA_SLOT,
        },
        null,
      ),
    ).toBe(true);
    expect(
      pauses.isContainerPaused(
        { organizationId: "other", parentId: "root" },
        null,
      ),
    ).toBe(false);
    // A pause from another device never skips the session's active workspace.
    expect(pauses.isContainerPaused(pausedRoot, "paused")).toBe(false);
  } finally {
    close();
  }
});

test("notifies subscribers only when the set changes", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-sync-pauses-subscribe",
  );
  try {
    const pauses = getOrCreateOrganizationSyncPauses(createDomainScope());
    let notifications = 0;
    const unsubscribe = pauses.subscribe(() => {
      notifications += 1;
    });
    await pauses.replace(execSql, ["org-a"]);
    await pauses.replace(execSql, ["org-a"]);
    unsubscribe();
    await pauses.replace(execSql, []);

    expect(notifications).toBe(1);
  } finally {
    close();
  }
});

test("a pause set larger than SQLite binds persists whole", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-sync-pauses-bulk",
  );
  try {
    let maxBinds = 0;
    const boundedExecSql: typeof execSql = new Proxy(execSql, {
      apply(target, thisArg, args) {
        const bind = args[1];
        const binds = Array.isArray(bind) ? bind.length : 0;
        maxBinds = Math.max(maxBinds, binds);
        if (binds > 999)
          throw new Error(`SQLite bind limit exceeded: ${binds}`);
        return Reflect.apply(target, thisArg, args);
      },
    });
    const organizationIds = Array.from(
      { length: 1_001 },
      (_, index) => `org-${String(index).padStart(4, "0")}`,
    );

    await getOrCreateOrganizationSyncPauses(createDomainScope()).replace(
      boundedExecSql,
      organizationIds,
    );

    const reopened = getOrCreateOrganizationSyncPauses(createDomainScope());
    await reopened.load(execSql);
    expect(reopened.pausedOrganizationIds().size).toBe(organizationIds.length);
    expect(maxBinds).toBeLessThanOrEqual(999);
  } finally {
    close();
  }
});

test("resuming an organization forgets only its removed documents", async () => {
  const { close, execSql } = await createTestExecSql(
    "organization-sync-pause-removals",
  );
  try {
    const pauses = getOrCreateOrganizationSyncPauses(createDomainScope());
    await pauses.replace(execSql, ["org-a", "org-b"]);
    await recordPauseRemovedDocument(execSql, {
      localId: "doc-a",
      organizationId: "org-a",
    });
    await recordPauseRemovedDocument(execSql, {
      localId: "doc-b",
      organizationId: "org-b",
    });

    await pauses.replace(execSql, ["org-b"]);

    expect(await isPauseRemovedDocument(execSql, "doc-a")).toBe(false);
    expect(await isPauseRemovedDocument(execSql, "doc-b")).toBe(true);
  } finally {
    close();
  }
});
