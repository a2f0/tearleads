import { expect, spyOn, test } from "bun:test";
import * as crypto from "@tearleads/crypto";
import { isContainerReciteResponse } from "@tearleads/validators/response";
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
  await recite(created, child.accessManifest, RECITATIONS);

  // Each mutation verified and marked its predecessor; a read verifies at most
  // the unmarked head, whatever the history length.
  const firstRead = await countProjectionSignatureChecks(
    child.containerId,
    owner.token,
  );
  expect(firstRead).toBeLessThanOrEqual(2);
  expect(
    await countProjectionSignatureChecks(child.containerId, owner.token),
  ).toBe(0);

  // Without markers (a rotated secret) the whole history verifies again.
  await clearAccessManifestVerificationMarkers();
  expect(
    await countProjectionSignatureChecks(child.containerId, owner.token),
  ).toBeGreaterThan(RECITATIONS);
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
  // The lineage loads in bulk; 20 more manifests add no per-manifest loads.
  expect(after).toBe(before);
}, 120_000);
