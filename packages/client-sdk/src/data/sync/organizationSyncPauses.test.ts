import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDomainScope } from "../shared/domainScope";
import {
  getOrCreateOrganizationSyncPauses,
  isRetainedWhileSyncPaused,
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
    expect(pauses.isContainerPaused(metadataRoot)).toBe(false);
    expect(
      pauses.isContainerPaused({ organizationId: "paused", parentId: null }),
    ).toBe(true);
    expect(
      pauses.isContainerPaused({
        organizationId: "paused",
        parentId: "root",
        systemSlot: METADATA_SLOT,
      }),
    ).toBe(true);
    expect(
      pauses.isContainerPaused({ organizationId: "other", parentId: "root" }),
    ).toBe(false);
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
