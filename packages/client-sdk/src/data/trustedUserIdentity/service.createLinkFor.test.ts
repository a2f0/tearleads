import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  identityLinkFixture,
  LINK_TRUST_DOMAIN,
  LINK_USER_ID,
} from "./identityLink.testFixtures";
import { createTrustedUserIdentityService } from "./service";
import type { RemoteUserIdentityCandidate } from "./types";

const APP_URL = "https://app.example.test";
const UNKNOWN_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function peerService(
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  remote: RemoteUserIdentityCandidate,
) {
  return createTrustedUserIdentityService({
    getExecSql: () => execSql,
    getLocalUserId: () => null,
    getLocalIdentity: () => null,
    identityTrustDomain: LINK_TRUST_DOMAIN,
    remoteSource: { load: async () => remote, invalidate: () => {} },
  });
}

test("a link-verified peer re-shares as a link another device accepts", async () => {
  const first = await createTestExecSql("create-link-for-verified");
  const second = await createTestExecSql("create-link-for-recipient");
  const bob = await identityLinkFixture();
  try {
    const service = peerService(first.execSql, bob.remote);
    const verified = await service.verifyLink(bob.link);
    const link = await service.createLinkFor(LINK_USER_ID, APP_URL);
    expect(link).toBe(bob.link);
    if (!link) throw new Error("expected a link");
    const accepted = await peerService(second.execSql, bob.remote).verifyLink(
      link,
    );
    expect(accepted.signingKeyFingerprint).toBe(verified.signingKeyFingerprint);
    expect(accepted.encapsulationKeyFingerprint).toBe(
      verified.encapsulationKeyFingerprint,
    );
  } finally {
    first.close();
    second.close();
  }
});

test("an observed (TOFU) pin never becomes a shareable link", async () => {
  const { close, execSql } = await createTestExecSql("create-link-for-tofu");
  const bob = await identityLinkFixture();
  try {
    const service = peerService(execSql, bob.remote);
    expect(await service.resolve(LINK_USER_ID)).not.toBeNull();
    expect(await service.resolvePinned(LINK_USER_ID)).not.toBeNull();
    expect(await service.createLinkFor(LINK_USER_ID, APP_URL)).toBeNull();
  } finally {
    close();
  }
});

test("an unknown user has no link and is never fetched", async () => {
  const { close, execSql } = await createTestExecSql("create-link-for-none");
  try {
    const service = createTrustedUserIdentityService({
      getExecSql: () => execSql,
      getLocalUserId: () => null,
      getLocalIdentity: () => null,
      identityTrustDomain: LINK_TRUST_DOMAIN,
      remoteSource: {
        load: async () => {
          throw new Error("must not fetch");
        },
        invalidate: () => {},
      },
    });
    expect(await service.createLinkFor(UNKNOWN_USER_ID, APP_URL)).toBeNull();
  } finally {
    close();
  }
});

test("the signed-in user's link comes from local keys, like createLink", async () => {
  const bob = await identityLinkFixture();
  const service = createTrustedUserIdentityService({
    getExecSql: () => null,
    getLocalUserId: () => LINK_USER_ID,
    getLocalIdentity: () => bob.local,
    identityTrustDomain: LINK_TRUST_DOMAIN,
    remoteSource: {
      load: async () => {
        throw new Error("must not fetch");
      },
      invalidate: () => {},
    },
  });
  const own = await service.createLink(APP_URL);
  expect(await service.createLinkFor(LINK_USER_ID, APP_URL)).toBe(own);
});
