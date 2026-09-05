import { afterEach, expect, test } from "bun:test";
import { getOrCreateDomainSyncCoordinator } from "@tearleads/client-sdk";
import type { ExecSql } from "@tearleads/client-sdk/sqlite";
import { createTestExecSql } from "@tearleads/test-utils";
import { waitFor } from "@testing-library/react";
import { createHeadlessApiClient } from "../../../test/helpers/headlessApiClient";
import {
  listProxiedApiRequests,
  resetMockServer,
  useTestApiAppHandlers,
} from "../../../test/helpers/mswServer";

afterEach(resetMockServer);

test("a committed share racing a local rename preserves both after reconciliation", async () => {
  useTestApiAppHandlers();
  const ownerDb = await createTestExecSql("share-rename-owner");
  const peerDb = await createTestExecSql("share-rename-peer");
  const persistStarted = Promise.withResolvers<void>();
  const releasePersist = Promise.withResolvers<void>();
  let armed = false;
  let held = false;
  let folderId: string | null = null;
  const delayed = new Proxy(ownerDb.execSql, {
    apply: async (target, _receiver, args: Parameters<ExecSql>) => {
      const rows = await target(...args);
      if (
        armed &&
        !held &&
        args[0].startsWith('insert into "containers"') &&
        listProxiedApiRequests().some(
          (request) =>
            request.method === "POST" &&
            new URL(request.url).pathname === `/containers/${folderId}/share` &&
            request.status === 200,
        )
      ) {
        held = true;
        persistStarted.resolve();
        await releasePersist.promise;
      }
      return rows;
    },
  });
  const owner = await createHeadlessApiClient(delayed, "share-rename-owner");
  const peer = await createHeadlessApiClient(
    peerDb.execSql,
    "share-rename-peer",
  );
  const coordinator = getOrCreateDomainSyncCoordinator(
    owner.runtime.input().state.domainScope,
  );
  try {
    const rootId = owner.session.containerId;
    const userId = peer.session.userId;
    if (!rootId || !userId) throw new Error("Registration did not finish");
    const directory = await owner.organizations.loadDirectoryAndGroups();
    if (!directory) throw new Error("Organization directory is missing");
    await owner.organizations.addUserToGroup({
      expectedGroupName: "Members",
      groupId: directory.memberGroupId,
      targetUserId: userId,
    });
    const tree = owner.containerContents.openTree();
    tree.updateRuntime(owner.containerContents.workflowRuntime());
    await waitFor(() => expect(tree.getSnapshot().ready).toBe(true));
    const folder = await tree.createChild(rootId, "Before rename");
    if (!folder) throw new Error("Folder creation failed");
    folderId = folder.id;
    expect(await coordinator.waitForIdle({ timeoutMs: 10_000 })).toBe(true);
    armed = true;
    const share = tree.shareWithUser(folder.id, userId);
    await Promise.race([
      persistStarted.promise,
      share.then(() => {
        throw new Error("Share finished before its persistence was held");
      }),
    ]);
    const rename = tree.renameContainer(folder.id, "Renamed during share");
    releasePersist.resolve();
    expect(await share).toBe(false);
    expect((await rename)?.name).toBe("Renamed during share");
    expect(await coordinator.waitForIdle({ timeoutMs: 10_000 })).toBe(true);
    await waitFor(() =>
      expect(
        tree.getSnapshot().nodes.find((node) => node.id === folder.id)?.name,
      ).toBe("Renamed during share"),
    );
    const local = await ownerDb.execSql(
      'select "display_name" from "container_projection" where "container_id" = ?',
      [folder.id],
    );
    expect(local).toEqual([{ display_name: "Renamed during share" }]);
    const info = await owner.containerContents.loadContainerInfo({
      containerId: folder.id,
      remoteInfoMode: "always",
    });
    expect(info.remoteInfo?.grants).toContainEqual({
      accessLevel: "write",
      subjectId: userId,
      subjectType: "user",
    });
    const peerTree = peer.containerContents.openTree();
    peerTree.updateRuntime(peer.containerContents.workflowRuntime());
    await waitFor(() => expect(peerTree.getSnapshot().ready).toBe(true));
    expect(await peerTree.refresh()).toBe(true);
    await waitFor(
      () =>
        expect(
          peerTree.getSnapshot().nodes.find((node) => node.id === folder.id)
            ?.name,
        ).toBe("Renamed during share"),
      { timeout: 10_000 },
    );
  } finally {
    releasePersist.resolve();
    await coordinator.waitForIdle({ timeoutMs: 2_000 });
    owner.dispose();
    peer.dispose();
    ownerDb.close();
    peerDb.close();
  }
}, 30_000);
