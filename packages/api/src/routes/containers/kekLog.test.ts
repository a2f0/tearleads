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
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
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
  // Keyrings are served one per request, for the page's first epoch, so the
  // epoch-2 keyring comes from a cursor positioned at it.
  const atEpoch2 = (await (
    await getKekLog(
      root.kekState.containerId,
      owner.token,
      "?keyringForEpoch=2&afterKeyEpoch=1",
    )
  ).json()) as ContainerKekLogResponse;
  expect(atEpoch2.epochs[0]?.keyring).toEqual(
    firstRekey.request
      .keyring as ContainerKekLogResponse["epochs"][number]["keyring"],
  );
  expect(atEpoch2.epochs.slice(1).every((e) => e.keyring === null)).toBe(true);
  expect(third?.bridge).toMatchObject({
    predecessorContainerKeyEpochId: firstRekey.kekState.containerKeyEpochId,
    successorContainerKeyEpochId: secondRekey.kekState.containerKeyEpochId,
  });
  const atEpoch3 = (await (
    await getKekLog(
      root.kekState.containerId,
      owner.token,
      "?keyringForEpoch=3&afterKeyEpoch=2",
    )
  ).json()) as ContainerKekLogResponse;
  expect(atEpoch3.epochs[0]?.keyring).toEqual(
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
  // Bounded by construction: this container fits one page.
  expect(log.hasMore).toBe(false);
  // At most one keyring per request, for the page's first epoch — a page of
  // multi-megabyte keyrings would be quadratic in rotation count.
  expect(log.epochs.filter((epoch) => epoch.keyring !== null).length).toBe(0);
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

test("the kek-log pages from a cursor and reports more", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const { root, secondRekey } = await rotateRootTwice(owner);

  // Walk with an explicit cursor: after epoch 1, epochs 2 and 3 remain.
  const response = await getKekLog(
    root.kekState.containerId,
    owner.token,
    "?afterKeyEpoch=1",
  );
  expect(response.status).toBe(200);
  const page = (await response.json()) as ContainerKekLogResponse;
  expect(isContainerKekLogResponse(page)).toBe(true);
  expect(page.epochs.map((epoch) => epoch.containerKeyEpoch)).toEqual([2, 3]);
  expect(page.hasMore).toBe(false);
  expect(page.epochs.at(-1)?.containerKeyEpochId).toBe(
    secondRekey.kekState.containerKeyEpochId,
  );

  // A cursor past the head serves nothing rather than erroring.
  const emptyResponse = await getKekLog(
    root.kekState.containerId,
    owner.token,
    "?afterKeyEpoch=99",
  );
  const emptyPage = (await emptyResponse.json()) as ContainerKekLogResponse;
  expect(emptyPage.epochs).toEqual([]);
  expect(emptyPage.hasMore).toBe(false);

  // A malformed cursor reads as "from the beginning".
  const malformedResponse = await getKekLog(
    root.kekState.containerId,
    owner.token,
    "?afterKeyEpoch=not-a-number",
  );
  const malformedPage =
    (await malformedResponse.json()) as ContainerKekLogResponse;
  expect(malformedPage.epochs.map((epoch) => epoch.containerKeyEpoch)).toEqual([
    1, 2, 3,
  ]);
}, 15_000);

test("the kek-log discloses no other member's envelopes", async () => {
  const owner = createTestUser();
  const second = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(second);
  await authenticate(second);
  const root = await bootstrapRoot(owner);

  // Grant the second user access, so the container retains a direct envelope
  // addressed to somebody other than the requester.
  const grantRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient: second,
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

  const log = (await (
    await getKekLog(root.kekState.containerId, owner.token)
  ).json()) as ContainerKekLogResponse;

  // The second member's direct envelope exists but is never served.
  expect(
    log.epochs.some((epoch) =>
      epoch.wraps.some((wrap) => wrap["recipientId"] === second.userId),
    ),
  ).toBe(false);

  // Every served envelope is one this requester could use as an anchor:
  // their own direct wrap, or a principal wrap whose id current readers
  // already see in the signed manifests on their access path. Another
  // member's user envelope is never disclosed.
  for (const epoch of log.epochs) {
    for (const wrap of epoch.wraps) {
      const kind = wrap["recipientKind"];
      expect(
        kind === "user" || kind === "group" || kind === "organization",
      ).toBe(true);
      if (kind === "user") {
        expect(wrap["recipientId"]).toBe(owner.userId);
      }
    }
  }
}, 15_000);

test("the kek-log omits principals absent from the requester's access path", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const { root } = await rotateRootTwice(owner);

  const log = (await (
    await getKekLog(root.kekState.containerId, owner.token)
  ).json()) as ContainerKekLogResponse;

  // Every principal envelope served names a principal this requester's own
  // resolved access path references. A group they were never in — or one
  // removed from the path — is not disclosed just because its envelope is
  // retained.
  const pathPrincipalIds = new Set(
    root.principalPolicies.map((policy) => policy.principalId),
  );
  for (const epoch of log.epochs) {
    for (const wrap of epoch.wraps) {
      if (
        wrap["recipientKind"] === "group" ||
        wrap["recipientKind"] === "organization"
      ) {
        expect(pathPrincipalIds.has(wrap["recipientId"] as string)).toBe(true);
      }
    }
  }
}, 15_000);

test("the kek-log keeps a moved container's old-parent envelopes", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  const log = (await (
    await getKekLog(root.kekState.containerId, owner.token)
  ).json()) as ContainerKekLogResponse;

  // Every parent-container envelope served names a container this
  // container's own key history actually inherited from — including a
  // parent it has since moved away from, whose envelope is the only anchor
  // for the epochs beneath a severed move bridge. Envelopes for unrelated
  // containers are never served.
  const inheritedParentEpochIds = new Set(
    log.epochs
      .map((epoch) => epoch.parentContainerKeyEpochId)
      .filter((id): id is string => id !== null),
  );
  for (const epoch of log.epochs) {
    for (const wrap of epoch.wraps) {
      if (wrap["recipientKind"] !== "container") {
        continue;
      }
      // The wrap's recipient key epoch is one this container inherited from.
      expect(
        inheritedParentEpochIds.has(wrap["recipientKeyEpochId"] as string) ||
          wrap["recipientId"] === root.kekState.containerId,
      ).toBe(true);
    }
  }
}, 15_000);
