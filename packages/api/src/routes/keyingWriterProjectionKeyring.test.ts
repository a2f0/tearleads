import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  CONTAINER_KEK_KEYRING_SEAL_SUITE,
  type ContainerKekKeyring,
  openContainerKekKeyring,
  verifyContainerKekKeyringEntry,
} from "@tearleads/crypto";
import {
  type DocumentWriterProjectionResponse,
  isContainerMutationResponse,
  isDocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../test/helpers/containerRekey";
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

function rootContainerKek(projection: unknown) {
  expect(isDocumentWriterProjectionResponse(projection)).toBe(true);
  const typed = projection as DocumentWriterProjectionResponse;
  const path = typed.authorizingContainerPaths[0];
  if (!path) throw new Error("expected an authorizing container path");
  const kek = path.containerKeks.at(-1);
  if (!kek) throw new Error("expected a container KEK");
  return kek;
}

async function postRekey(
  owner: TestUser,
  containerId: string,
  request: unknown,
): Promise<void> {
  const response = await routeApp.request(`/containers/${containerId}/rekey`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  expect(response.status).toBe(200);
}

test("the projection ships the sealed keyring in place of predecessor KEKs", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });

  const before = await getWriterProjection(owner, created.id);
  expect(before.response.status).toBe(200);
  const initial = rootContainerKek(before.projection);
  expect(initial.containerKeyEpoch).toBe(1);
  // Epoch 1 has no history to seal, so its projection carries no keyring.
  expect(initial.keyring).toBeNull();
  expect("predecessorKeks" in initial).toBe(false);

  const { revokedKek } = await shareAndRevokeRoot({ owner, root });
  const after = await getWriterProjection(owner, created.id);
  expect(after.response.status).toBe(200);
  const current = rootContainerKek(after.projection);
  expect(current.containerKeyEpochId).toBe(revokedKek.containerKeyEpochId);
  expect("predecessorKeks" in current).toBe(false);
  expect(current.keyring).toMatchObject({
    containerId: root.kekState.containerId,
    containerKeyEpochId: revokedKek.containerKeyEpochId,
    sealingSuite: CONTAINER_KEK_KEYRING_SEAL_SUITE,
    version: 1,
  });
}, 15_000);

test("opening the served keyring under the current KEK yields the full history", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const created = await createDocument({ owner, root });
  const firstRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  await postRekey(owner, root.kekState.containerId, firstRekey.request);
  const secondRekey = await buildRootContainerRekeyMutation({
    previous: firstRekey.container,
    signer: owner,
  });
  await postRekey(owner, root.kekState.containerId, secondRekey.request);

  const projection = await getWriterProjection(owner, created.id);
  expect(projection.response.status).toBe(200);
  const current = rootContainerKek(projection.projection);
  expect(current.containerKeyEpoch).toBe(3);
  expect(current.containerKeyEpochId).toBe(
    secondRekey.kekState.containerKeyEpochId,
  );

  const entries = await openContainerKekKeyring({
    keyEpoch: current.containerKeyEpoch,
    keyring: current.keyring as unknown as ContainerKekKeyring,
    successorContainerKey: secondRekey.plaintextKek,
  });
  // Entry ordinal i is key epoch i + 1: the registered epoch-1 KEK, then the
  // first-rekey epoch-2 KEK, each recovered in the one decrypt.
  expect(entries.map((entry) => entry.containerKeyEpochId)).toEqual([
    root.kekState.containerKeyEpochId,
    firstRekey.kekState.containerKeyEpochId,
  ]);
  expect(entries).toEqual([...secondRekey.keyringEntries]);
  // The first-rekey key is real material minted by the helper, so its epoch id
  // recomputes from the recovered key. (The registration helper discards the
  // epoch-1 plaintext, so that entry is stand-in material by kit design and is
  // asserted by identity above instead.)
  const epochTwoEntry = entries[1];
  if (!epochTwoEntry) throw new Error("expected the epoch-2 keyring entry");
  await expect(
    verifyContainerKekKeyringEntry({
      containerId: root.kekState.containerId,
      entry: epochTwoEntry,
      keyEpoch: 2,
    }),
  ).resolves.toBeUndefined();
}, 15_000);

test("a member granted current access after rotation receives the same keyring", async () => {
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

  const ownerView = await getWriterProjection(owner, created.id);
  expect(ownerView.response.status).toBe(200);
  const newcomerView = await getWriterProjection(newcomer, created.id);
  expect(newcomerView.response.status).toBe(200);
  const ownerKek = rootContainerKek(ownerView.projection);
  const newcomerKek = rootContainerKek(newcomerView.projection);
  expect(newcomerKek.containerKeyEpochId).toBe(revokedKek.containerKeyEpochId);
  expect(newcomerKek.keyring).not.toBeNull();
  expect(newcomerKek.keyring).toEqual(ownerKek.keyring);
}, 15_000);
