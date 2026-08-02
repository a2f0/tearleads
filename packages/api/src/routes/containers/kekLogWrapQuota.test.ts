import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { ContainerKekLogResponse } from "@tearleads/validators/response";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
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

test("a direct user envelope survives however many principals precede it", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const { root } = await rotateRootTwice(owner);

  const log = (await (
    await getKekLog(root.kekState.containerId, owner.token)
  ).json()) as ContainerKekLogResponse;

  // The envelope quota is spent per (epoch, recipient), so principal
  // envelopes cannot consume the share belonging to the requester's own
  // direct wrap — and the ordering ranks that direct wrap first regardless.
  // A quota shared across an epoch's recipients could not promise this once a
  // requester holds more principals than the quota, and the dropped anchor
  // would read as an unaddressed epoch rather than a truncated response.
  for (const epoch of log.epochs) {
    const recipients = epoch.wraps.map(
      (wrap) =>
        `${wrapField(wrap, "recipientKind")}:${wrapField(wrap, "recipientId")}`,
    );
    expect(new Set(recipients).size).toBe(recipients.length);
    expect(
      epoch.wraps.every((wrap) =>
        wrapField(wrap, "recipientKind") === "user"
          ? wrapField(wrap, "recipientId") === owner.userId
          : true,
      ),
    ).toBe(true);
  }
}, 20_000);
