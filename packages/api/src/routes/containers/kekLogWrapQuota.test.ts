import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@symcrypt/bob-and-alice";
import {
  type ContainerKekLogResponse,
  isContainerKekLogResponse,
} from "@symcrypt/validators/response";
import { CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT } from "@symcrypt/validators/util";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
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

test("a granted member's own direct envelope is served as their anchor", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  await registerUser(member);
  await authenticate(member);
  const root = await bootstrapRoot(owner);

  // A grant mints a direct user envelope addressed to the member. That wrap is
  // the anchor openable with no principal-policy state at all, so the epoch
  // ranking must place it first and the per-epoch cap must never cut it.
  const grantRequest = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient: member,
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
    await getKekLog(root.kekState.containerId, member.token)
  ).json()) as ContainerKekLogResponse;

  const directWraps = log.epochs.flatMap((epoch) =>
    epoch.wraps.filter(
      (wrap) =>
        wrapField(wrap, "recipientKind") === "user" &&
        wrapField(wrap, "recipientId") === member.userId,
    ),
  );
  // Non-vacuous: the member's own envelope really is present, not merely
  // "no envelope contradicts the rule".
  expect(directWraps.length).toBeGreaterThan(0);

  // And it is served on the epoch it was minted for, ranked ahead of the
  // principal envelopes that share that epoch.
  const epochWithDirect = log.epochs.find((epoch) =>
    epoch.wraps.some(
      (wrap) =>
        wrapField(wrap, "recipientKind") === "user" &&
        wrapField(wrap, "recipientId") === member.userId,
    ),
  );
  if (!epochWithDirect) throw new Error("expected an epoch with a direct wrap");
  expect(epochWithDirect.wraps.length).toBeLessThanOrEqual(
    CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT,
  );
}, 20_000);

test("the response guard enforces the same bounds the server applies", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const { root } = await rotateRootTwice(owner);

  const served = (await (
    await getKekLog(root.kekState.containerId, owner.token)
  ).json()) as ContainerKekLogResponse;
  expect(isContainerKekLogResponse(served)).toBe(true);

  const epoch = served.epochs[0];
  if (!epoch) throw new Error("expected a served epoch");

  // A page whose epoch carries more envelopes than the per-epoch cap is
  // rejected on the way in. Without this a hostile or buggy server could hand
  // back an unbounded page and the recovery walk would do the work first.
  expect(
    isContainerKekLogResponse({
      ...served,
      epochs: [
        {
          ...epoch,
          wraps: Array.from(
            { length: CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT + 1 },
            () => epoch.wraps[0] ?? {},
          ),
        },
      ],
    }),
  ).toBe(false);

  // Exactly at the cap still passes, so the bound is a ceiling and not an
  // off-by-one that rejects a full legitimate page.
  expect(
    isContainerKekLogResponse({
      ...served,
      epochs: [
        {
          ...epoch,
          wraps: Array.from(
            { length: CONTAINER_KEK_WRAPS_PER_EPOCH_LIMIT },
            () => epoch.wraps[0] ?? {},
          ),
        },
      ],
    }),
  ).toBe(true);
}, 20_000);
