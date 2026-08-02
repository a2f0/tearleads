import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import {
  type ContainerKekPredecessorBridge,
  computeContainerKekMaterialId,
  unwrapContainerKekPredecessorBridge,
} from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import {
  type ContainerKekLogResponse,
  type ContainerMutationResponse,
  isContainerKekLogResponse,
} from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { buildRootRevokeRequest } from "../../../test/helpers/keyingWriterProjectionRevoke";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

/**
 * Reads a wire-record field. A variable key satisfies both the index-signature
 * rule and the literal-key lint, which disagree about `record.field`.
 */
function wrapField(wrap: Record<string, unknown>, key: string): unknown {
  return wrap[key];
}

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
          wrapField(wrap, "containerKeyEpochId") ===
            epoch.containerKeyEpochId &&
          typeof wrapField(wrap, "wrappedKey") === "string" &&
          typeof wrapField(wrap, "kemCipherText") === "string",
      ),
    ).toBe(true);
  }
  expect(
    log.epochs.every((epoch) =>
      epoch.wraps.every((wrap) => wrapField(wrap, "recipientKind") === "group"),
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
      epoch.wraps.some(
        (wrap) => wrapField(wrap, "recipientId") === second.userId,
      ),
    ),
  ).toBe(false);

  // Every served envelope is one this requester could use as an anchor:
  // their own direct wrap, or a principal wrap whose id current readers
  // already see in the signed manifests on their access path. Another
  // member's user envelope is never disclosed.
  for (const epoch of log.epochs) {
    for (const wrap of epoch.wraps) {
      const kind = wrapField(wrap, "recipientKind");
      expect(
        kind === "user" || kind === "group" || kind === "organization",
      ).toBe(true);
      if (kind === "user") {
        expect(wrapField(wrap, "recipientId")).toBe(owner.userId);
      }
    }
  }
}, 15_000);

test("the kek-log omits a removed member's retained envelope", async () => {
  const owner = createTestUser();
  const removed = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(removed);
  await authenticate(removed);
  const root = await bootstrapRoot(owner);

  // Grant, then revoke. The revoked member's envelope is RETAINED — that is
  // the protocol invariant — so it is exactly the disclosure this filter
  // exists to prevent.
  const grantRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient: removed,
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
  const granted = (await grantResponse.json()) as ContainerMutationResponse;

  // Revoke: the epoch rotates and the removed member's OLD envelope stays
  // retained, which is the post-revocation disclosure this filter prevents.
  const revokeRequest = await buildRootRevokeRequest({
    previous: granted.accessManifest as unknown as AccessManifestBundleWire,
    previousKekState: root.kekState,
    revokedUser: removed,
    signer: owner,
  });
  const revokeResponse = await routeApp.request(
    `/containers/${root.kekState.containerId}/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(revokeRequest),
    },
  );
  expect(revokeResponse.status).toBe(200);

  const log = (await (
    await getKekLog(root.kekState.containerId, owner.token)
  ).json()) as ContainerKekLogResponse;

  // The removed member's retained envelope is never served here.
  expect(
    log.epochs.some((epoch) =>
      epoch.wraps.some(
        (wrap) => wrapField(wrap, "recipientId") === removed.userId,
      ),
    ),
  ).toBe(false);
  for (const epoch of log.epochs) {
    for (const wrap of epoch.wraps) {
      if (wrapField(wrap, "recipientKind") === "user") {
        expect(wrapField(wrap, "recipientId")).toBe(owner.userId);
      }
    }
  }
}, 20_000);

test("the kek-log serves only parents this container inherited from", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);

  const log = (await (
    await getKekLog(root.kekState.containerId, owner.token)
  ).json()) as ContainerKekLogResponse;

  // A root inherits from nothing, so no parent-container envelope may be
  // served for it. The scope is derived from this container's own epochs,
  // which is what keeps a moved container's OLD parent in scope while
  // unrelated containers stay out.
  for (const epoch of log.epochs) {
    expect(epoch.parentContainerKeyEpochId).toBeNull();
    expect(
      epoch.wraps.some(
        (wrap) => wrapField(wrap, "recipientKind") === "container",
      ),
    ).toBe(false);
  }
}, 15_000);

test("every epoch keeps its own anchors rather than sharing one page quota", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const { root } = await rotateRootTwice(owner);

  const log = (await (
    await getKekLog(root.kekState.containerId, owner.token)
  ).json()) as ContainerKekLogResponse;

  // The envelope quota is spent PER EPOCH, so a wide epoch can never consume
  // a later epoch's share. If the bound were a single page-wide limit, the
  // epochs sorting last would come back empty and recovery would read that as
  // "no addressed envelope" — a false unreachability rather than a real one.
  expect(log.epochs.length).toBe(3);
  for (const epoch of log.epochs) {
    // Every epoch carries at least one envelope this requester can open —
    // here the owning group's, since a bootstrapped root addresses its owner
    // through their principal rather than a direct user wrap.
    expect(epoch.wraps.length).toBeGreaterThan(0);
  }
}, 20_000);
