import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { createTestExecSql } from "@tearleads/test-utils";
import { setGeneratedIdentity } from "../../../test/helpers/clientTestSupport";
import { loadTrustedUserIdentityPin } from "../../data/persistence/trustedUserIdentityPinPersistence";
import { createTrustedUserIdentityService } from "../../data/trustedUserIdentity/service";
import { Database } from "../database";
import { createIdentity } from "../identity";
import { createSession } from "./index";

test("a fresh session refuses login rebinding a durably pinned signing fingerprint", async () => {
  const { close, execSql } = await createTestExecSql(
    "session-durable-inverse-binding",
  );
  const identity = createIdentity(
    {},
    () => undefined,
    () => undefined,
  );
  await setGeneratedIdentity(identity);
  const identityTrustDomain = "https://identity.example.test";
  const incidents: unknown[] = [];
  const login = (userId: string) => {
    const api = new ApiClient(identityTrustDomain);
    api.authenticate = async () => ({
      authenticated: true,
      isRoot: false,
      organizationId: "organization",
      rootContainerId: null,
      token: "server-token",
      userId,
    });
    const trust = createTrustedUserIdentityService({
      getExecSql: () => execSql,
      getLocalIdentity: () => null,
      getLocalUserId: () => null,
      identityTrustDomain,
      remoteSource: { load: async () => null, invalidate: () => undefined },
    });
    const session = createSession({
      api,
      database: new Database(),
      identity,
      log: () => undefined,
      logError: () => undefined,
      onUserIdentityAvailable: async (id, candidate) => {
        await trust.pinLocal(id, candidate);
      },
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    });
    return { api, session };
  };
  try {
    const first = login("11111111-1111-4111-8111-111111111111");
    expect(await first.session.login()).toBe(true);
    const restarted = login("22222222-2222-4222-8222-222222222222");
    expect(restarted.session.userIdAcknowledged).toBe(false);
    const published: (string | null)[] = [];
    restarted.session.subscribe(() => {
      published.push(restarted.session.userId);
    });
    await expect(restarted.session.login()).rejects.toMatchObject({
      code: "equivocation",
    });
    expect(restarted.session.isAuthenticated).toBe(false);
    expect(restarted.api.getAuthToken()).toBeNull();
    expect(published).not.toContain("22222222-2222-4222-8222-222222222222");
    expect(incidents).toEqual([
      expect.objectContaining({ code: "equivocation" }),
    ]);
    expect(
      await loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain,
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBeNull();
    expect(
      await login("11111111-1111-4111-8111-111111111111").session.login(),
    ).toBe(true);
  } finally {
    close();
  }
});
