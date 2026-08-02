import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  type ContainerKekPredecessorBridge,
  computeContainerKekMaterialId,
  unwrapContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import {
  type ContainerKekLogResponse,
  isContainerKekLogResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function getKekLog(
  containerId: string,
  token?: string,
  query = "",
): Promise<Response> {
  return routeApp.request(
    `/containers/${containerId}/kek-log${query}`,
    token ? { headers: { Authorization: `Bearer ${token}` } } : {},
  );
}

async function rotateRootTwice(owner: TestUser) {
  const root = await bootstrapRoot(owner);
  const firstRekey = await buildRootContainerRekeyMutation({
    previous: root,
    signer: owner,
  });
  const secondRekey = await buildRootContainerRekeyMutation({
    previous: firstRekey.container,
    signer: owner,
  });

  for (const rekey of [firstRekey, secondRekey]) {
    const response = await routeApp.request(
      `/containers/${root.kekState.containerId}/rekey`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(rekey.request),
      },
    );
    expect(response.status).toBe(200);
  }

  return { firstRekey, root, secondRekey };
}

test("GET /containers/:containerId/kek-log serves the full rotation log ascending", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const { firstRekey, root, secondRekey } = await rotateRootTwice(owner);

  const response = await getKekLog(
    root.kekState.containerId,
    owner.token,
    "?include=keyrings",
  );
  expect(response.status).toBe(200);
  const log = (await response.json()) as ContainerKekLogResponse;
  expect(isContainerKekLogResponse(log)).toBe(true);
  expect(log.containerId).toBe(root.kekState.containerId);
  expect(log.epochs.map((epoch) => epoch.containerKeyEpoch)).toEqual([1, 2, 3]);

  // Without the opt-in, the log stays O(epochs): bridges and wraps only.
  const defaultResponse = await getKekLog(
    root.kekState.containerId,
    owner.token,
  );
  const defaultLog = (await defaultResponse.json()) as ContainerKekLogResponse;
  expect(defaultLog.epochs.every((epoch) => epoch.keyring === null)).toBe(true);
  expect(defaultLog.epochs.map((epoch) => epoch.bridge === null)).toEqual([
    true,
    false,
    false,
  ]);
  expect(log.epochs.map((epoch) => epoch.containerKeyEpochId)).toEqual([
    root.kekState.containerKeyEpochId,
    firstRekey.kekState.containerKeyEpochId,
    secondRekey.kekState.containerKeyEpochId,
  ]);

  const [initial, second, third] = log.epochs;
  // The initial epoch predates every rotation: no bridge, nothing to seal.
  expect(initial?.bridge).toBeNull();
  expect(initial?.keyring).toBeNull();
  expect(second?.bridge).toMatchObject({
    containerId: root.kekState.containerId,
    predecessorContainerKeyEpochId: root.kekState.containerKeyEpochId,
    successorContainerKeyEpochId: firstRekey.kekState.containerKeyEpochId,
  });
  expect(second?.keyring).toEqual(
    firstRekey.request
      .keyring as ContainerKekLogResponse["epochs"][number]["keyring"],
  );
  expect(third?.bridge).toMatchObject({
    predecessorContainerKeyEpochId: firstRekey.kekState.containerKeyEpochId,
    successorContainerKeyEpochId: secondRekey.kekState.containerKeyEpochId,
  });
  expect(third?.keyring).toEqual(
    secondRekey.request
      .keyring as ContainerKekLogResponse["epochs"][number]["keyring"],
  );

  // The severed-bridge backstop: every epoch retains its recipient
  // envelopes (group-addressed here, since root access flows through the
  // Admins principal), so a member present at a historical epoch can recover
  // its KEK from their envelope independent of every later bridge. The
  // client-side journey with direct user wraps and real KEM decapsulation
  // lives in client-sdk rekey.test.ts.
  for (const epoch of log.epochs) {
    expect(
      epoch.wraps.some(
        (wrap) =>
          wrap["containerKeyEpochId"] === epoch.containerKeyEpochId &&
          typeof wrap["wrappedKey"] === "string" &&
          typeof wrap["kemCipherText"] === "string",
      ),
    ).toBe(true);
  }
  expect(
    log.epochs.every((epoch) =>
      epoch.wraps.every((wrap) => wrap["recipientKind"] === "group"),
    ),
  ).toBe(true);
}, 15_000);

test("the kek-log bridges rebuild every predecessor key from the current KEK", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const { firstRekey, root, secondRekey } = await rotateRootTwice(owner);

  const response = await getKekLog(root.kekState.containerId, owner.token);
  expect(response.status).toBe(200);
  const log = (await response.json()) as ContainerKekLogResponse;

  // Rebuild journey: from the current KEK, each bridge decrypts its immediate
  // predecessor, so walking the log newest-to-oldest recovers the chain.
  let successorKey = secondRekey.plaintextKek;
  const recoveredKeys: Uint8Array[] = [];
  for (const epoch of [...log.epochs].reverse()) {
    if (epoch.bridge === null) {
      expect(epoch.containerKeyEpoch).toBe(1);
      continue;
    }
    const predecessorKey = await unwrapContainerKekPredecessorBridge({
      bridge: epoch.bridge as unknown as ContainerKekPredecessorBridge,
      successorContainerKey: successorKey,
    });
    recoveredKeys.push(predecessorKey);
    successorKey = predecessorKey;
  }

  expect(recoveredKeys).toEqual([
    firstRekey.plaintextKek,
    // The registration helper discards the epoch-1 plaintext, so the first
    // rotation bridged stand-in material; it is still the exact bytes the
    // rotation's keyring committed for epoch 1.
    ...(firstRekey.keyringEntries[0]
      ? [firstRekey.keyringEntries[0].keyMaterial]
      : []),
  ]);
  // Recovered real material recomputes its committed epoch id.
  const recomputedEpochId = await computeContainerKekMaterialId({
    containerId: root.kekState.containerId,
    keyEpoch: 2,
    keyMaterial: firstRekey.plaintextKek,
  });
  expect<string>(recomputedEpochId).toBe(
    firstRekey.kekState.containerKeyEpochId,
  );
}, 15_000);

test("GET /containers/:containerId/kek-log requires authentication", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  const response = await getKekLog(root.kekState.containerId);
  expect(response.status).toBe(401);
});

test("GET /containers/:containerId/kek-log rejects non-members", async () => {
  const owner = createTestUser();
  const outsider = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(outsider);
  await authenticate(outsider);
  const root = await bootstrapRoot(owner);

  const response = await getKekLog(root.kekState.containerId, outsider.token);
  // Matches the writer-projection route's non-member rejection.
  expect(response.status).toBe(403);
});

test("GET /containers/:containerId/kek-log returns 404 for unknown containers", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);

  const response = await getKekLog(crypto.randomUUID(), owner.token);
  expect(response.status).toBe(404);
});
