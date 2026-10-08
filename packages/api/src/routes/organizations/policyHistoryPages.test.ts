import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalHistoryIndexNodes,
  principalHistoryProgress,
  principalStatePayloads,
} from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { computePrincipalStatePayloadCiphertextHash } from "@tearleads/crypto";
import { clearPrincipalPolicySignatureCaches } from "@tearleads/crypto/principal-policy-test-fixtures";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  OrganizationPolicyHistoryResponseSchema,
  PrincipalPolicyBundleResponseSchema,
} from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { seedLongPrincipalHistory } from "../../../test/helpers/longPrincipalHistory";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import {
  getPolicy,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { clearStoredPolicySnapshotCache } from "../../../test/helpers/principalSnapshotVerificationCache";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

async function page(
  actor: TestUser,
  organizationId: string,
  stateHash: string,
  beforeVersion?: number,
) {
  const query = new URLSearchParams({ stateHash });
  if (beforeVersion !== undefined)
    query.set("beforeVersion", String(beforeVersion));
  let preparations = 0;
  while (true) {
    const response = await routeApp.request(
      `/organizations/${organizationId}/policy-history?${query}`,
      { headers: { Authorization: `Bearer ${actor.token}` } },
    );
    const body = await response.json();
    if (response.status === 202) {
      expect(body).toMatchObject({
        code: "principal_history_preparation_pending",
        committed: false,
      });
      expect(++preparations).toBeLessThan(20);
      continue;
    }
    expect(response.status, JSON.stringify(body)).toBe(200);
    return {
      body: OrganizationPolicyHistoryResponseSchema.parse(body),
      preparations,
    };
  }
}

test("cold organization display pages pin a head and carry only 32 directories plus a boundary", async () => {
  const actor = createTestUser();
  await registerAndAuthenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const policy = PrincipalPolicyBundleResponseSchema.parse(
    await (await getPolicy(actor, "organization", organizationId)).json(),
  );
  await seedLongPrincipalHistory({ actor, policy, throughVersion: 65 });
  await db.delete(principalHistoryProgress);
  await db.delete(principalHistoryIndexNodes);
  clearPrincipalPolicySignatureCaches();
  clearStoredPolicySnapshotCache();
  const target = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  if (!target) throw new Error("Missing target");
  const first = await page(actor, organizationId, target.stateHash);
  expect(first.preparations).toBeGreaterThan(0);
  expect(first.body.beforeVersion).toBe(66);
  expect(first.body.nextBeforeVersion).toBe(34);
  expect(
    first.body.evidence.organizationPayloads.map(
      ({ reference }) => reference.version,
    ),
  ).toEqual(Array.from({ length: 33 }, (_, i) => i + 33));
  expect(
    first.body.evidence.groups.every((source) => !("previousStates" in source)),
  ).toBe(true);
  const oldPayload = first.body.evidence.organizationPayloads[1]?.payload;
  if (!oldPayload) throw new Error("Missing older directory payload");
  const changed = bytesToBase64(
    new TextEncoder().encode(
      new TextDecoder().decode(base64ToBytes(oldPayload.ciphertext)) + " ",
    ),
  );
  const rowScope = and(
    eq(principalStatePayloads.principalId, organizationId),
    eq(principalStatePayloads.stateHash, oldPayload.stateHash),
  );
  await db
    .update(principalStatePayloads)
    .set({
      ciphertext: changed,
      ciphertextHash: await computePrincipalStatePayloadCiphertextHash(changed),
    })
    .where(rowScope);
  try {
    const refused = await routeApp.request(
      `/organizations/${organizationId}/policy-history?${new URLSearchParams({ stateHash: target.stateHash })}`,
      { headers: { Authorization: `Bearer ${actor.token}` } },
    );
    expect(refused.status).toBe(409);
  } finally {
    await db
      .update(principalStatePayloads)
      .set({
        ciphertext: oldPayload.ciphertext,
        ciphertextHash: oldPayload.ciphertextHash,
      })
      .where(rowScope);
  }
  const next = await page(actor, organizationId, target.stateHash, 34);
  expect(next.body.nextBeforeVersion).toBe(2);
  expect(
    next.body.evidence.organizationPayloads.map(
      ({ reference }) => reference.version,
    ),
  ).toEqual(Array.from({ length: 33 }, (_, i) => i + 1));
  const last = await page(actor, organizationId, target.stateHash, 2);
  expect(last.body.nextBeforeVersion).toBeNull();
  expect(last.body.evidence.organizationPayloads).toHaveLength(1);
  expect(last.body.evidence.organization?.head.stateHash).toBe(
    target.stateHash,
  );
}, 30_000);

test("organization history rejects a cursor beyond its pinned head and a foreign head", async () => {
  const actor = createTestUser();
  const other = createTestUser();
  await registerAndAuthenticate(actor, other);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const otherOrganizationId = await getDefaultOrganizationId(other.userId);
  const head = await getCurrentPrincipalState(
    "organization",
    organizationId,
    db,
  );
  const foreign = await getCurrentPrincipalState(
    "organization",
    otherOrganizationId,
    db,
  );
  if (!head || !foreign) throw new Error("Missing organization heads");
  const valid = await page(actor, organizationId, head.stateHash);
  expect(valid.body.evidence.organization?.head.principalId).toBe(
    organizationId,
  );
  for (const query of [
    { stateHash: head.stateHash, beforeVersion: String(head.version + 2) },
    { stateHash: foreign.stateHash },
  ]) {
    const response = await routeApp.request(
      `/organizations/${organizationId}/policy-history?${new URLSearchParams(query)}`,
      { headers: { Authorization: `Bearer ${actor.token}` } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty("evidence");
  }
}, 15_000);
