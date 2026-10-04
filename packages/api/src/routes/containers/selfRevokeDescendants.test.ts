import { expect, test } from "bun:test";
import {
  revokeRemoteContainer,
  shareRemoteContainer,
} from "@tearleads/client-sdk";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import {
  createOwnedTree,
  isPathCurrent,
} from "../../../test/helpers/ownedContainerTree";

test("self-revoke refuses clearly without stranding a deeper grantee", async () => {
  const tree = await createOwnedTree(2);
  const [revoker, writer] = tree.members;
  if (!revoker || !writer) throw new Error("Expected members");
  const owner = await createAncestorSdkContext(
    tree.owner,
    tree.organizationId,
    ...tree.members,
  );
  const actor = await createAncestorSdkContext(
    revoker,
    tree.organizationId,
    tree.owner,
    writer,
  );
  const ownerSdk = {
    ...owner.common,
    resolveTrustedUserIdentity: owner.resolveTrustedUserIdentity,
    reportSecurityIncident: async () => undefined,
  };
  try {
    const container = await tree.createChild(tree.rootId);
    const intermediate = await tree.createChild(container);
    const leaf = await tree.createChild(intermediate);
    await tree.share(leaf, writer.userId);
    expect(
      await shareRemoteContainer({
        ...ownerSdk,
        containerId: container,
        accessLevel: "admin",
        recipientUserId: revoker.userId,
      }),
    ).not.toBeNull();
    const before = await tree.keksOf(leaf);
    const refusals: unknown[] = [];
    const submit = actor.common.apiClient.revokeContainerResult;
    if (!submit) throw new Error("Expected status-bearing revoke");
    actor.common.apiClient.revokeContainerResult = async (id, request) => {
      const result = await submit(id, request);
      refusals.push(result);
      return result;
    };
    const revokeInput = {
      ...actor.common,
      resolveTrustedUserIdentity: actor.resolveTrustedUserIdentity,
      reportSecurityIncident: async () => undefined,
      containerId: container,
      revokedSubject: {
        subjectId: revoker.userId,
        subjectType: "user" as const,
      },
    };
    expect(await revokeRemoteContainer(revokeInput)).toBeNull();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      ok: false,
      code: "container_descendant_rekeys_inaccessible",
      status: 409,
      requiredContainerIds: [intermediate],
    });
    expect(JSON.stringify(refusals[0])).toContain(
      "Ask an administrator or another writer",
    );
    expect(await tree.keksOf(leaf)).toEqual(before);

    // The same revoke succeeds when an authorized member carries the repairs.
    const completed = await revokeRemoteContainer({
      ...revokeInput,
      ...ownerSdk,
    });
    expect(
      completed?.response.containerRekeys?.map((rekey) => rekey.containerId),
    ).toEqual([intermediate]);
    expect(isPathCurrent((await tree.keksOf(leaf)).slice(0, -1))).toBe(true);
  } finally {
    actor.close();
    owner.close();
    tree.close();
  }
}, 180_000);

test("self-revoke can carry repairs through a retained descendant grant", async () => {
  const tree = await createOwnedTree(2);
  const [revoker, writer] = tree.members;
  if (!revoker || !writer) throw new Error("Expected members");
  const owner = await createAncestorSdkContext(
    tree.owner,
    tree.organizationId,
    ...tree.members,
  );
  const actor = await createAncestorSdkContext(
    revoker,
    tree.organizationId,
    tree.owner,
    writer,
  );
  try {
    const container = await tree.createChild(tree.rootId);
    const intermediate = await tree.createChild(container);
    const leaf = await tree.createChild(intermediate);
    await tree.share(leaf, writer.userId);
    await tree.share(intermediate, revoker.userId);
    expect(
      await shareRemoteContainer({
        ...owner.common,
        resolveTrustedUserIdentity: owner.resolveTrustedUserIdentity,
        reportSecurityIncident: async () => undefined,
        containerId: container,
        accessLevel: "admin",
        recipientUserId: revoker.userId,
      }),
    ).not.toBeNull();
    const completed = await revokeRemoteContainer({
      ...actor.common,
      reportSecurityIncident: async () => undefined,
      containerId: container,
      revokedSubject: { subjectId: revoker.userId, subjectType: "user" },
    });
    expect(
      completed?.response.containerRekeys?.map((rekey) => rekey.containerId),
    ).toEqual([intermediate]);
    expect(isPathCurrent((await tree.keksOf(leaf)).slice(0, -1))).toBe(true);
  } finally {
    actor.close();
    owner.close();
    tree.close();
  }
}, 180_000);
