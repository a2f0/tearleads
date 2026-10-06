import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalPolicyCommits } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computePrincipalStateHash,
  signPrincipalState,
} from "@tearleads/crypto";
import { PrincipalPolicyMutationResponseSchema } from "@tearleads/validators/response";
import { and, eq, isNull } from "drizzle-orm";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { prepareOrganizationPolicyAdvance } from "../../../test/helpers/organizationPolicyOutcome";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { createRequestLifetimeBindings } from "../../middleware/requestLifetime";
import { createRouteApp } from "../../routeApp";

test("a lost standalone directory acknowledgement survives a later directory head", async () => {
  const actor = createTestUser();
  await registerAndAuthenticate(actor);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const prepared = await prepareOrganizationPolicyAdvance(
    actor,
    organizationId,
  );
  const { body } = prepared;
  const { state } = body;
  const published: Record<string, unknown>[] = [];
  const routeApp = createRouteApp({
    publish: async (event) => {
      published.push(event);
    },
  });
  const committed = Promise.withResolvers<unknown>();
  const release = Promise.withResolvers<void>();
  let hold = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const response = await routeApp.fetch(
        request,
        createRequestLifetimeBindings(request, server),
      );
      if (hold && response.status === 200) {
        hold = false;
        committed.resolve(await response.clone().json());
        await release.promise;
      }
      return response;
    },
  });
  const controller = new AbortController();
  const { path, init } = prepared;
  const { headers } = init;
  const exact = init.body;
  try {
    const pending = fetch(new URL(path, server.url), {
      method: "PUT",
      headers,
      body: exact,
      signal: controller.signal,
    }).catch((error: unknown) => error);
    const first = PrincipalPolicyMutationResponseSchema.parse(
      await Promise.race([
        committed.promise,
        pending.then(() => {
          throw new Error("Commit barrier not reached");
        }),
      ]),
    );
    controller.abort();
    expect(await pending).toBeInstanceOf(Error);
    release.resolve();
    const next = await signPrincipalState(
      {
        ...state,
        version: state.version + 1,
        prevStateHash: await computePrincipalStateHash(state),
      },
      actor.signing.signingPrivateKey,
    );
    const advanced = await fetch(new URL(path, server.url), {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...body, state: next }),
    });
    expect(advanced.status).toBe(200);
    await advanced.arrayBuffer();
    expect(
      published.filter(
        (event) => Reflect.get(event, "type") === "principal_access_changed",
      ),
    ).toEqual([]);
    expect(
      published.filter(
        (event) =>
          Reflect.get(event, "type") === "organization_read_model_changed",
      ),
    ).toHaveLength(2);
    const publishedCount = published.length;
    const replays = await Promise.all(
      [0, 1].map(() => fetch(new URL(path, server.url), init)),
    );
    for (const replay of replays) {
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual(first);
    }
    expect(published).toHaveLength(publishedCount);
    expect(
      (await getCurrentPrincipalState("organization", organizationId, db))
        ?.version,
    ).toBe(next.version);
    const altered = await fetch(new URL(path, server.url), {
      method: "PUT",
      headers,
      body: JSON.stringify({
        ...body,
        encryptedPayload: { ...body.encryptedPayload, ciphertext: "AAAA" },
      }),
    });
    expect([400, 409]).toContain(altered.status);
    await altered.arrayBuffer();
    const receiptFilter = and(
      eq(principalPolicyCommits.organizationId, organizationId),
      isNull(principalPolicyCommits.groupId),
    );
    const receipts = await db
      .select()
      .from(principalPolicyCommits)
      .where(receiptFilter);
    expect(receipts).toHaveLength(2);
    try {
      for (const responseJson of [
        "{",
        "{}",
        JSON.stringify({
          ...first,
          currentState: { ...first.currentState, stateHash: "wrong" },
        }),
      ]) {
        await db
          .update(principalPolicyCommits)
          .set({ responseJson })
          .where(receiptFilter);
        const corrupt = await fetch(new URL(path, server.url), init);
        expect(corrupt.status).toBe(409);
        await corrupt.arrayBuffer();
      }
    } finally {
      for (const receipt of receipts)
        await db
          .update(principalPolicyCommits)
          .set({ responseJson: receipt.responseJson })
          .where(eq(principalPolicyCommits.requestHash, receipt.requestHash));
    }
  } finally {
    controller.abort();
    release.resolve();
    await server.stop(true);
  }
}, 20_000);
