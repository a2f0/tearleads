import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { accessEvents, accessManifests } from "@tearleads/api-shared/schema";
import * as crypto from "@tearleads/crypto";
import { isContainerReciteResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  postRecite as post,
  buildReciteRequest as request,
  createReciteScenario as scenario,
} from "../../../test/helpers/containerRecite";
import { clearAccessManifestVerificationMarkers } from "../../../test/helpers/verificationMarkers";
import * as manifestStore from "../../access/read/accessManifestStore";
import { routeApp } from "../../routeApp";

const RECITATIONS = 40;

type ReciteScenario = Awaited<ReturnType<typeof scenario>>;

async function recite(
  created: ReciteScenario,
  head: ReciteScenario["child"]["accessManifest"],
  count: number,
) {
  const { owner, root, child } = created;
  let current = head;
  for (let index = 0; index < count; index += 1) {
    const signed = await request({
      path: [root.bundle, current],
      signer: owner,
    });
    const response = await post(child.containerId, owner, signed);
    expect(response.status, await response.clone().text()).toBe(200);
    const body: unknown = await response.json();
    if (!isContainerReciteResponse(body))
      throw new Error("Expected recite response");
    current = body.accessManifest;
  }
  return current;
}

async function countSingleManifestLoads(
  containerId: string,
  token: string,
): Promise<number> {
  const select = spyOn(manifestStore, "getAccessManifestBundle");
  try {
    const response = await routeApp.request(
      `/containers/${containerId}/writer-projection`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return select.mock.calls.length;
  } finally {
    select.mockRestore();
  }
}

async function countProjectionSignatureChecks(
  containerId: string,
  token: string,
): Promise<number> {
  const verify = spyOn(crypto, "verifySignedAccessEvent");
  try {
    const response = await routeApp.request(
      `/containers/${containerId}/writer-projection`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    return verify.mock.calls.length;
  } finally {
    verify.mockRestore();
  }
}

test("a long signed history is verified about once, not on every read", async () => {
  const created = await scenario();
  const { owner, child } = created;
  const last = await recite(created, child.accessManifest, RECITATIONS);

  // Each mutation marked the head it stored, so no read re-verifies history.
  expect(
    await countProjectionSignatureChecks(child.containerId, owner.token),
  ).toBe(0);

  // Without markers (a rotated secret) reads verify the whole history, and
  // being reads they never write markers back.
  await clearAccessManifestVerificationMarkers();
  for (let read = 0; read < 2; read += 1)
    expect(
      await countProjectionSignatureChecks(child.containerId, owner.token),
    ).toBeGreaterThan(RECITATIONS);
  // The next mutation re-marks the history under its organization lock.
  await recite(created, last, 1);
  expect(
    await countProjectionSignatureChecks(child.containerId, owner.token),
  ).toBe(0);
}, 120_000);

test("reading a longer history issues no queries per retained manifest", async () => {
  const created = await scenario();
  const { owner, child } = created;
  const shorter = await recite(created, child.accessManifest, 20);
  await countSingleManifestLoads(child.containerId, owner.token);
  const before = await countSingleManifestLoads(child.containerId, owner.token);
  await recite(created, shorter, 20);
  await countSingleManifestLoads(child.containerId, owner.token);
  const after = await countSingleManifestLoads(child.containerId, owner.token);
  // Path heads still load singly, which proves the spy observes the loader;
  // the lineage loads in bulk, so 20 more manifests add no per-manifest loads.
  expect(before).toBeGreaterThan(0);
  expect(after).toBe(before);
}, 120_000);

test("a marked head does not hide an edited predecessor row", async () => {
  const created = await scenario();
  const { owner, child } = created;
  const head = await recite(created, child.accessManifest, 3);
  expect(
    await countProjectionSignatureChecks(child.containerId, owner.token),
  ).toBe(0);
  // Edit a stored predecessor's signed event in place; its marker no longer
  // matches the bundle, so the read must verify it and refuse.
  const previousHash = Reflect.get(head.manifest, "previousManifestHash");
  if (typeof previousHash !== "string") throw new Error("Expected predecessor");
  const [predecessor] = await db
    .select({ eventHash: accessManifests.eventHash })
    .from(accessManifests)
    .where(eq(accessManifests.manifestHash, previousHash));
  if (!predecessor) throw new Error("Expected stored predecessor");
  await db
    .update(accessEvents)
    .set({ signature: "invalid" })
    .where(eq(accessEvents.eventHash, predecessor.eventHash));
  const response = await routeApp.request(
    `/containers/${child.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${owner.token}` } },
  );
  expect(response.status).toBe(409);
}, 120_000);
