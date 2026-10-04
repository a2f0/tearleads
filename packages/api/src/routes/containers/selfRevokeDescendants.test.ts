import { expect, test } from "bun:test";
import {
  buildMaterializedContainerRekeyPlan,
  revokeRemoteContainer,
  shareRemoteContainer,
} from "@tearleads/client-sdk";
import {
  type ContainerAccessManifestState,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
} from "@tearleads/crypto";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { createSignedAccessEvent } from "../../../test/helpers/keyingWriterProjectionKit";
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

    // A custom client can skip the empty first submit. Re-sign the carried
    // rekey against the post-revoke path, bypassing the SDK's access guard.
    // Existing cryptographic batch preflight must reject its lost authority.
    const intermediateProjection =
      await actor.common.apiClient.getContainerWriterProjection(intermediate);
    if (!intermediateProjection) throw new Error("Expected intermediate");
    const carried = await buildMaterializedContainerRekeyPlan({
      ...actor.common,
      persistVerificationCheckpoints: false,
      previousProjection: intermediateProjection,
    });
    actor.common.apiClient.revokeContainerResult = async (id, request) => {
      if (!request.expectedManifestHash)
        throw new Error("Expected revoke hash");
      const revokeHash = request.expectedManifestHash;
      const previousContainerPath =
        carried.plan.request.previousContainerPath?.map((bundle, index) =>
          index === 1
            ? {
                manifestHash: revokeHash,
                manifest: request.manifest,
                event: {
                  event: request.event,
                  body: request.body,
                  eventHash: Reflect.get(request.manifest, "eventHash"),
                },
                state: {
                  ...bundle.state,
                  epoch: Reflect.get(request.manifest, "epoch"),
                  previousManifestHash: Reflect.get(
                    request.manifest,
                    "previousManifestHash",
                  ),
                  eventHash: Reflect.get(request.manifest, "eventHash"),
                  containerKeyEpochId: Reflect.get(
                    Object(request.body),
                    "containerKeyEpochId",
                  ),
                  containerKeyPublicKey: Reflect.get(
                    Object(request.body),
                    "containerKeyPublicKey",
                  ),
                  directGrants: (
                    bundle.state as unknown as ContainerAccessManifestState
                  ).directGrants.filter(
                    (grant) =>
                      grant.subjectType !== "user" ||
                      grant.subjectId !== revoker.userId,
                  ),
                },
              }
            : bundle,
        ) ?? [];
      const body = {
        ...carried.plan.body,
        parentManifestHash: request.expectedManifestHash,
      };
      const event = await createSignedAccessEvent({
        body,
        dependencyManifestHashes: previousContainerPath.map(
          (bundle) => bundle.manifestHash,
        ),
        objectId: intermediate,
        objectKind: "container",
        organizationId: tree.organizationId,
        previousManifestHash: carried.plan.state.previousManifestHash,
        signer: revoker,
      });
      const manifest = await deriveContainerAccessManifest({
        ...carried.plan.state,
        parentManifestHash: request.expectedManifestHash,
        eventHash: event.eventHash,
      });
      const result = await submit(id, {
        ...request,
        containerRekeys: [
          {
            ...carried.plan.request,
            body,
            event: { ...event.event },
            manifest: { ...manifest },
            expectedManifestHash: await computeAccessManifestHash(manifest),
            previousContainerPath,
          },
        ],
      });
      refusals.push(result);
      return result;
    };
    expect(await revokeRemoteContainer(revokeInput)).toBeNull();
    expect(refusals).toHaveLength(2);
    expect(refusals[1]).toMatchObject({
      ok: false,
      status: 403,
    });
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
