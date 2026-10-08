import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalDirectoryBindings,
  principalStatePayloads,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computePrincipalStateHash,
  signPrincipalState,
} from "@tearleads/crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  createGroupRequest,
  deleteGroupRequest,
} from "../../../test/helpers/organizationGroup";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { submitOrganizationGroupPolicyCommit } from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import * as stateStore from "../../access/read/principalStateStore";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";
import { parseOrganizationAuthorityDescriptor } from "../organizations/organizationAuthorityDescriptor";
import {
  clearProjectionDirectoryBindingsCache,
  loadProjectionDirectoryBindings,
} from "./projectionDirectoryBindings";
import { storeVerifiedPrincipalDirectoryBindings } from "./storeVerifiedPrincipalDirectoryBindings";

async function fixture() {
  const actor = createTestUser();
  await registerAndAuthenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const organization = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  if (!organization) throw new Error("Missing organization");
  const payload = await stateStore.getPrincipalStatePayloadForState(
    "organization",
    organizationId,
    organization.stateHash,
    db,
  );
  const directory =
    payload && parseOrganizationAuthorityDescriptor(payload.ciphertext);
  if (!directory) throw new Error("Missing directory");
  return { actor, organizationId, organization, directory };
}

test("directory bindings read only requested groups and isolate memo callers", async () => {
  const f = await fixture();
  const input = {
    executor: db,
    organization: f.organization,
    groupIds: [f.directory.memberGroupId],
  };
  const read = spyOn(stateStore, "getPrincipalStatePayloadForState");
  try {
    const first = await loadProjectionDirectoryBindings(input);
    expect(first.latest.size).toBe(2);
    first.latest.clear();
    first.bindingPayloadByGroupState.clear();
    const again = await loadProjectionDirectoryBindings(input);
    expect(again.latest.size).toBe(2);
    expect(again.bindingPayloadByGroupState.size).toBe(2);
    expect(read).toHaveBeenCalledTimes(1);
    const smaller = await loadProjectionDirectoryBindings({
      ...input,
      groupIds: [],
    });
    expect([...smaller.latest.keys()]).toEqual([f.directory.adminGroupId]);
  } finally {
    read.mockRestore();
  }
});

test("deleted group bindings remain scoped to their signed directory and pin", async () => {
  const f = await fixture();
  const groupId = crypto.randomUUID();
  const body = await createGroupRequest({
    actor: f.actor,
    groupId,
    name: "History",
  });
  const created = await routeApp.request(
    `/organizations/${f.organizationId}/groups`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${f.actor.token}`,
      },
      body: JSON.stringify(body),
    },
  );
  expect(created.status).toBe(200);
  await created.arrayBuffer();
  const successor = await submitOrganizationGroupPolicyCommit({
    actor: f.actor,
    organizationId: f.organizationId,
    groupId,
    groupPolicy: {
      ...body.initialGroupPolicy,
      state: await signPrincipalState(
        {
          ...body.initialGroupPolicy.state,
          version: 2,
          prevStateHash: await computePrincipalStateHash(
            body.initialGroupPolicy.state,
          ),
        },
        f.actor.signing.signingPrivateKey,
      ),
    },
  });
  expect(successor.status).toBe(200);
  await successor.arrayBuffer();
  const repeated = await getCurrentPrincipalState(
    "organization",
    f.organizationId,
    db,
  );
  if (!repeated) throw new Error("Missing repeated directory");
  const repeatedPayload = await stateStore.getPrincipalStatePayloadForState(
    "organization",
    f.organizationId,
    repeated.stateHash,
    db,
  );
  if (!repeatedPayload) throw new Error("Missing repeated directory payload");
  await db.transaction((executor) =>
    storeVerifiedPrincipalDirectoryBindings({
      executor,
      state: repeated,
      ciphertext: repeatedPayload.ciphertext,
    }),
  );
  const deleted = await deleteGroupRequest({
    actor: f.actor,
    organizationId: f.organizationId,
    groupId,
  });
  expect(deleted.status).toBe(200);
  await deleted.arrayBuffer();
  const organization = await getCurrentPrincipalState(
    "organization",
    f.organizationId,
    db,
  );
  if (!organization) throw new Error("Missing successor directory");
  const input = { executor: db, organization, groupIds: [groupId] };
  clearProjectionDirectoryBindingsCache();
  const recovered = await loadProjectionDirectoryBindings(input);
  expect(recovered.latest.get(groupId)).toMatchObject({
    principalId: groupId,
    version: 2,
  });
  const group = recovered.latest.get(groupId);
  expect(
    group && recovered.bindingPayloadByGroupState.get(group.stateHash),
  ).toBeDefined();
  // An index entry created later cannot be used beneath an older exact pin.
  await expect(
    loadProjectionDirectoryBindings({ ...input, organization: f.organization }),
  ).rejects.toThrow("binding missing");
  const where = and(
    eq(principalDirectoryBindings.organizationId, f.organizationId),
    eq(principalDirectoryBindings.groupId, groupId),
  );
  const [row] = await db
    .select()
    .from(principalDirectoryBindings)
    .where(where)
    .orderBy(desc(principalDirectoryBindings.organizationVersion));
  if (!row) throw new Error("Missing retained binding row");
  expect(
    await db.select().from(principalDirectoryBindings).where(where),
  ).toHaveLength(2);
  await db
    .update(principalDirectoryBindings)
    .set({ groupStateHash: "f".repeat(64) })
    .where(eq(principalDirectoryBindings.id, row.id));
  clearProjectionDirectoryBindingsCache();
  await expect(loadProjectionDirectoryBindings(input)).rejects.toThrow(
    "binding differs",
  );
  await db
    .update(principalDirectoryBindings)
    .set({ groupStateHash: row.groupStateHash })
    .where(eq(principalDirectoryBindings.id, row.id));
  const foreign = await fixture();
  await db
    .update(principalDirectoryBindings)
    .set({ organizationStateHash: foreign.organization.stateHash })
    .where(eq(principalDirectoryBindings.id, row.id));
  await expect(loadProjectionDirectoryBindings(input)).rejects.toThrow(
    "binding missing",
  );
  await db
    .update(principalDirectoryBindings)
    .set({ organizationStateHash: row.organizationStateHash })
    .where(eq(principalDirectoryBindings.id, row.id));
  expect(
    (await loadProjectionDirectoryBindings(input)).latest.get(groupId)?.version,
  ).toBe(2);
});

test("a changed directory payload fails hash verification without poisoning the memo", async () => {
  const f = await fixture();
  const where = and(
    eq(principalStatePayloads.principalId, f.organizationId),
    eq(principalStatePayloads.stateHash, f.organization.stateHash),
  );
  const [payload] = await db.select().from(principalStatePayloads).where(where);
  if (!payload) throw new Error("Missing directory payload");
  const input = {
    executor: db,
    organization: f.organization,
    groupIds: [f.directory.memberGroupId],
  };
  try {
    await db
      .update(principalStatePayloads)
      .set({ ciphertext: "AAAA" })
      .where(where);
    await expect(loadProjectionDirectoryBindings(input)).rejects.toThrow(
      "payload hash mismatch",
    );
  } finally {
    await db
      .update(principalStatePayloads)
      .set({ ciphertext: payload.ciphertext })
      .where(where);
  }
  expect((await loadProjectionDirectoryBindings(input)).latest.size).toBe(2);
});
