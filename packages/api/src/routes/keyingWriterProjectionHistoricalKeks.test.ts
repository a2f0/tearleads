import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import type { ContainerKeyWrap } from "@tearleads/crypto";
import {
  type DocumentWriterProjectionResponse,
  isContainerMutationResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import {
  bootstrapRoot,
  buildRootGrantRequest,
  createDocument,
} from "../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../test/helpers/registerUser";
import {
  getWriterProjection,
  shareAndRevokeRoot,
} from "../../test/helpers/staleBundleHealKit";
import { routeApp } from "../routeApp";

// After a revoke rotates a container's KEK epoch, documents whose content-key
// bundles wrap to the superseded epoch are unreadable unless the member can
// still unwrap that epoch. The projection therefore serves superseded epochs
// alongside each path container — but with wraps filtered to recipients the
// REQUESTER can use, so historical audience metadata is not broadcast and a
// post-rotation member receives nothing from before their time.

function rootContainerKeks(projection: unknown) {
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  const typed = projection as DocumentWriterProjectionResponse;
  const path = typed.authorizingContainerPaths[0];
  expect(path).toBeDefined();
  if (!path) throw new Error("expected an authorizing container path");
  const kek = path.containerKeks.at(-1);
  expect(kek).toBeDefined();
  if (!kek) throw new Error("expected a container KEK");
  return kek;
}

test("the projection serves the superseded KEK epoch to a member spanning the rotation, wraps filtered to the requester", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  // Before any rotation there is nothing historical to serve.
  const before = await getWriterProjection(owner, created.id);
  expect(before.response.status).toBe(200);
  expect(rootContainerKeks(before.projection).historicalKeks).toBeUndefined();

  const { revokedKek } = await shareAndRevokeRoot({ owner, root });

  const { response, projection } = await getWriterProjection(owner, created.id);
  expect(response.status).toBe(200);
  const kek = rootContainerKeks(projection);
  expect(kek.containerKeyEpochId).toBe(revokedKek.containerKeyEpochId);

  const historicalKeks = kek.historicalKeks ?? [];
  expect(historicalKeks.map((epoch) => epoch.containerKeyEpochId)).toEqual([
    root.kekState.containerKeyEpochId,
  ]);
  const historical = historicalKeks[0];
  expect(historical).toBeDefined();
  if (!historical) throw new Error("expected a historical KEK epoch");
  expect(historical.containerId).toBe(root.kekState.containerId);
  expect(historical.containerKeyEpoch).toBe(root.kekState.containerKeyEpoch);

  // Only wraps the requester can use survive the filter. The owner unwraps
  // this epoch through the admins principal wrap; the single user wrap at
  // the epoch belongs to the revoked recipient (added by the share) and must
  // not be served to the owner.
  const wraps = historical.wraps as unknown as readonly ContainerKeyWrap[];
  expect(wraps.length).toBeGreaterThan(0);
  for (const wrap of wraps) {
    expect(wrap.containerKeyEpochId).toBe(root.kekState.containerKeyEpochId);
    expect(wrap.recipientKind).not.toBe("user");
  }
}, 15_000);

test("a member granted access after the rotation receives no historical epochs", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const { revokedKek, revokedManifest } = await shareAndRevokeRoot({
    owner,
    root,
  });

  const newcomer = createTestUser();
  await registerUser(newcomer);
  await authenticate(newcomer);
  const grantRequest = await buildRootGrantRequest({
    previous: revokedManifest,
    previousKekState: revokedKek,
    recipient: newcomer,
    signer: owner,
  });
  const grantResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grantRequest),
    },
  );
  expect(grantResponse.status).toBe(200);
  expect(isContainerMutationResponse(await grantResponse.json())).toBe(true);

  // The newcomer has no wrap at the superseded epoch, so the filter leaves
  // nothing to serve and the epoch is omitted for them entirely.
  const newcomerView = await getWriterProjection(newcomer, created.id);
  expect(newcomerView.response.status).toBe(200);
  expect(
    rootContainerKeks(newcomerView.projection).historicalKeks,
  ).toBeUndefined();

  // The owner, who spans the rotation, still receives it.
  const ownerView = await getWriterProjection(owner, created.id);
  expect(ownerView.response.status).toBe(200);
  const ownerHistorical =
    rootContainerKeks(ownerView.projection).historicalKeks ?? [];
  expect(ownerHistorical.map((epoch) => epoch.containerKeyEpochId)).toEqual([
    root.kekState.containerKeyEpochId,
  ]);
}, 15_000);
