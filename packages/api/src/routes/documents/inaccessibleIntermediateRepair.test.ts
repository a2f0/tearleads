import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  buildMaterializedContainerRekeyPlan,
  createRemoteContainer,
  rekeyRemoteContainer,
  shareRemoteContainer,
} from "@tearleads/client-sdk";
import { createAncestorSdkContext } from "../../../test/helpers/ancestorSdkRepair";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  COLD_DOCUMENT_TEXT,
  coldRematerializeEncryptedDocument,
  createEncryptedColdDocument,
} from "../../../test/helpers/coldSdkRematerialization";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { createLeafWriterAncestorEdit } from "../../../test/helpers/leafWriterAncestorEdit";
import { addOrganizationMember } from "../../../test/helpers/organizationMembership";
import { isPathCurrent } from "../../../test/helpers/ownedContainerTree";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

// #2340 finding 1. root -> intermediate -> leaf, the writer granted on the leaf
// alone. The writer can never re-key the intermediate (a rekey is authorized
// over the root-to-target path, which a leaf grant is not on) and is never
// given its key. So a rotation may not leave it stale: it carries the
// intermediate's rekey in its own transaction, and the writer's next write
// depends on no other device.

test("a rotation carries the levels above a granted container, so a leaf-only writer never waits", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const writer = createTestUser();
  await registerUser(writer);
  await authenticate(writer);
  const root = await bootstrapRoot(owner);
  const rootId = root.kekState.containerId;
  const organizationId = Reflect.get(root.bundle.state, "organizationId");
  if (typeof organizationId !== "string")
    throw new Error("Expected root organization");
  await addOrganizationMember({ actor: owner, member: writer, organizationId });
  const context = await createAncestorSdkContext(owner, organizationId, writer);
  try {
    const createChild = async (parentContainerId: string) => {
      const child = await createRemoteContainer({
        ...context.common,
        parentContainerId,
        parentSecretKey: owner.kem.secretKey,
        reportSecurityIncident: async () => undefined,
        resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
      });
      if (!child) throw new Error("Expected child");
      return child.containerId;
    };
    const intermediateId = await createChild(rootId);
    const leafId = await createChild(intermediateId);
    const created = await createEncryptedColdDocument({
      containerId: leafId,
      organizationId,
      owner,
    });
    const shared = await shareRemoteContainer({
      ...context.common,
      accessLevel: "write",
      containerId: leafId,
      recipientUserId: writer.userId,
      reportSecurityIncident: async () => undefined,
      resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
    });
    expect(shared).not.toBeNull();

    // A rotation that would strand the intermediate is refused whole, and
    // names what it must carry.
    const rootProjection =
      await context.common.apiClient.getContainerWriterProjection(rootId);
    if (!rootProjection) throw new Error("Expected root projection");
    const bare = await buildMaterializedContainerRekeyPlan({
      ...context.common,
      persistVerificationCheckpoints: false,
      previousProjection: rootProjection,
    });
    const refused = await routeApp.request(`/containers/${rootId}/rekey`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bare.plan.request),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "container_descendant_rekeys_required",
      requiredContainerIds: [intermediateId],
    });
    const afterRefusal =
      await context.common.apiClient.getContainerWriterProjection(rootId);
    expect(afterRefusal?.containerKeks.at(-1)?.containerKeyEpochId).toBe(
      rootProjection.containerKeks.at(-1)?.containerKeyEpochId,
    );

    // The SDK answers that refusal itself: one retry, the intermediate's rekey
    // carried, both committed together.
    const rotated = await rekeyRemoteContainer({
      ...context.common,
      containerId: rootId,
      reportSecurityIncident: async () => undefined,
    });
    expect(
      rotated?.response.containerRekeys?.map((rekey) => rekey.containerId),
    ).toEqual([intermediateId]);
    const intermediate =
      await context.common.apiClient.getContainerWriterProjection(
        intermediateId,
      );
    expect(isPathCurrent(intermediate?.containerKeks ?? [])).toBe(true);
    expect(intermediate?.containerKeks.at(-2)?.containerKeyEpochId).not.toBe(
      rootProjection.containerKeks.at(-1)?.containerKeyEpochId,
    );

    // No other device acts from here on. The writer's first write succeeds,
    // re-keying only its own leaf on the way.
    const edit = await createLeafWriterAncestorEdit({
      documentId: created.documentId,
      organizationId,
      owner,
      writer,
    });
    try {
      expect(edit.recoveredText).toBe(COLD_DOCUMENT_TEXT);
      const written = await edit.attemptWrite();
      expect(written?.settledPendingUpdateIds).toContain(edit.updateId);
      expect(edit.abandoned).toEqual([]);
      expect(edit.terminalCodes).toEqual([]);
      expect(edit.standaloneRepairs).toEqual([]);
      const write = edit.requests.find(
        (request) => request.outgoingUpdates.length > 0,
      );
      expect(
        write?.containerRekeys?.map((repair) =>
          Reflect.get(repair.event, "objectId"),
        ),
      ).toEqual([leafId]);
    } finally {
      edit.close();
    }
    const reader = await coldRematerializeEncryptedDocument({
      documentId: created.documentId,
      organizationId,
      owner: writer,
      reader: owner,
    });
    expect(reader.recoveredText).toBe(
      `${COLD_DOCUMENT_TEXT}; edited after rotation`,
    );
  } finally {
    context.close();
  }
}, 180_000);

// Grants nest. With root -> a -> b -> c -> d, `b` granted to one writer and `d`
// to another, a root rotation strands `a` (above `b`) and `b`, `c` (above `d`).
// `d` is its grantee's own to repair.

test("nested grants: every level above any granted container rides the rotation", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const upper = createTestUser();
  await registerUser(upper);
  await authenticate(upper);
  const lower = createTestUser();
  await registerUser(lower);
  await authenticate(lower);
  const root = await bootstrapRoot(owner);
  const rootId = root.kekState.containerId;
  const organizationId = Reflect.get(root.bundle.state, "organizationId");
  if (typeof organizationId !== "string")
    throw new Error("Expected root organization");
  for (const member of [upper, lower]) {
    await addOrganizationMember({ actor: owner, member, organizationId });
  }
  const context = await createAncestorSdkContext(
    owner,
    organizationId,
    upper,
    lower,
  );
  try {
    const chain: string[] = [];
    let parentContainerId = rootId;
    for (let level = 0; level < 4; level += 1) {
      const child = await createRemoteContainer({
        ...context.common,
        parentContainerId,
        parentSecretKey: owner.kem.secretKey,
        reportSecurityIncident: async () => undefined,
        resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
      });
      if (!child) throw new Error("Expected child");
      chain.push(child.containerId);
      parentContainerId = child.containerId;
    }
    const [a, b, c, d] = chain;
    if (!a || !b || !c || !d) throw new Error("Expected four levels");
    const created = await createEncryptedColdDocument({
      containerId: d,
      organizationId,
      owner,
    });
    for (const [containerId, recipient] of [
      [b, upper],
      [d, lower],
    ] as const) {
      const shared = await shareRemoteContainer({
        ...context.common,
        accessLevel: "write",
        containerId,
        recipientUserId: recipient.userId,
        reportSecurityIncident: async () => undefined,
        resolveTrustedUserIdentity: context.resolveTrustedUserIdentity,
      });
      expect(shared).not.toBeNull();
    }

    const rotated = await rekeyRemoteContainer({
      ...context.common,
      containerId: rootId,
      reportSecurityIncident: async () => undefined,
    });
    expect(
      rotated?.response.containerRekeys?.map((rekey) => rekey.containerId),
    ).toEqual([a, b, c]);
    const deepest =
      await context.common.apiClient.getContainerWriterProjection(d);
    expect(isPathCurrent(deepest?.containerKeks.slice(0, -1) ?? [])).toBe(true);

    const edit = await createLeafWriterAncestorEdit({
      documentId: created.documentId,
      organizationId,
      otherGrantees: [upper],
      owner,
      writer: lower,
    });
    try {
      const written = await edit.attemptWrite();
      expect(written?.settledPendingUpdateIds).toContain(edit.updateId);
      expect(edit.abandoned).toEqual([]);
      expect(edit.standaloneRepairs).toEqual([]);
      const write = edit.requests.find(
        (request) => request.outgoingUpdates.length > 0,
      );
      expect(
        write?.containerRekeys?.map((repair) =>
          Reflect.get(repair.event, "objectId"),
        ),
      ).toEqual([d]);
    } finally {
      edit.close();
    }
  } finally {
    context.close();
  }
}, 180_000);
