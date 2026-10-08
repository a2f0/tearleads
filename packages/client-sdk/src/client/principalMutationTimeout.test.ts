import { expect, test } from "bun:test";
import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../../test/helpers/clientTestSupport";
import { principalMutationJournalFixture } from "../../test/helpers/principalMutationJournalFixture";
import { createMemoryBlobStore } from "../data/blobs/memoryBlobStore";
import { claimPrincipalMutationJournal } from "../data/persistence/principalMutationJournalPersistence";
import { sealPrincipalMutation } from "../data/principals/principalMutationJournal";
import type { ExecSql } from "../data/sqlite/sqlSchema";
import { Tearleads } from "./Tearleads";

async function client(
  origin: string,
  timeoutMs: number,
  execSql: ExecSql,
  fixture: Awaited<ReturnType<typeof principalMutationJournalFixture>>,
) {
  const sdk = new Tearleads({
    apiBaseUrl: origin,
    blobStoreFactory: () => createMemoryBlobStore(),
    logger: quietLogger,
    principalMutationTimeoutMs: timeoutMs,
  });
  sdk.database.configure({ execSql, id: "configured-mutation-deadline" });
  await sdk.identity.setKeyPairs({
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    signingKeyPair: fixture.signingKeyPair,
  });
  sdk.session.setContext({
    userId: fixture.scope.userId,
    organizationId: fixture.scope.organizationId,
    authToken: "fixture-session",
    isAuthenticated: true,
  });
  return sdk;
}

test("a host can recover a slow exact request after increasing its deadline", async () => {
  const fixture = await principalMutationJournalFixture();
  const sqlite = await createTestExecSql("configured-mutation-deadline");
  const requests: unknown[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(await request.json());
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return Response.json(fixture.response);
    },
  });
  const clients: Tearleads[] = [];
  try {
    await claimPrincipalMutationJournal({
      execSql: sqlite.execSql,
      row: await sealPrincipalMutation({
        ...fixture,
        scope: { ...fixture.scope, identityTrustDomain: server.url.origin },
      }),
      stillCurrent: () => true,
    });
    const first = await client(server.url.origin, 500, sqlite.execSql, fixture);
    clients.push(first);
    await expect(
      first.organizations.retryPendingPolicyMutation(
        fixture.scope.organizationId,
      ),
    ).rejects.toThrow("may have committed");
    expect(
      await first.organizations.readPendingPolicyMutation(
        fixture.scope.organizationId,
      ),
    ).toEqual(fixture.mutation);
    first.dispose();
    clients.pop();
    const next = await client(
      server.url.origin,
      2_000,
      sqlite.execSql,
      fixture,
    );
    clients.push(next);
    await next.organizations.retryPendingPolicyMutation(
      fixture.scope.organizationId,
    );
    expect(
      await next.organizations.readPendingPolicyMutation(
        fixture.scope.organizationId,
      ),
    ).toBeNull();
    expect(requests).toEqual([
      fixture.mutation.request,
      fixture.mutation.request,
    ]);
  } finally {
    for (const sdk of clients) sdk.dispose();
    server.stop(true);
    sqlite.close();
  }
}, 8_000);
