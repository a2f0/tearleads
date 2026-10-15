import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { loadTrustedUserIdentityPin } from "../persistence/trustedUserIdentityPinPersistence";
import {
  identityLinkFixture,
  LINK_TRUST_DOMAIN,
  LINK_USER_ID,
} from "./identityLink.testFixtures";
import { createTrustedUserIdentityService } from "./service";
import {
  isTrustedUserIdentity,
  type RemoteUserIdentityCandidate,
} from "./types";

test("an independently anchored first contact pins both keys and survives service recreation", async () => {
  const { close, execSql } = await createTestExecSql("identity-link-accept");
  const fixture = await identityLinkFixture();
  let loads = 0;
  const dependencies = {
    getExecSql: () => execSql,
    getLocalUserId: () => null,
    getLocalIdentity: () => null,
    identityTrustDomain: LINK_TRUST_DOMAIN,
    remoteSource: {
      invalidate: () => {},
      load: async () => {
        loads++;
        return fixture.remote;
      },
    },
  };
  try {
    const verified = await createTrustedUserIdentityService(
      dependencies,
    ).verifyLink(fixture.link);
    expect(isTrustedUserIdentity(verified)).toBe(true);
    expect(verified.signingKeyFingerprint).toBe(
      fixture.remote.signingKeyFingerprint,
    );
    expect(verified.encapsulationKeyFingerprint).toBe(
      fixture.remote.encapsulationKeyFingerprint,
    );
    const restored =
      await createTrustedUserIdentityService(dependencies).resolve(
        LINK_USER_ID,
      );
    expect(restored).toEqual(verified);
    expect(loads).toBe(2);
  } finally {
    close();
  }
});

for (const key of ["signing", "encapsulation", "both"] as const) {
  test(`first-contact ${key} substitution fails before pinning or subsequent key use`, async () => {
    const { close, execSql } = await createTestExecSql(
      `identity-link-reject-${key}`,
    );
    const [bob, impostor] = await Promise.all([
      identityLinkFixture(1),
      identityLinkFixture(2),
    ]);
    const remote = {
      ...bob.remote,
      ...(key !== "encapsulation"
        ? {
            signingPublicKey: impostor.remote.signingPublicKey,
            signingKeyFingerprint: impostor.remote.signingKeyFingerprint,
          }
        : {}),
      ...(key !== "signing"
        ? {
            encapsulationPublicKey: impostor.remote.encapsulationPublicKey,
            encapsulationKeyFingerprint:
              impostor.remote.encapsulationKeyFingerprint,
          }
        : {}),
    };
    let invalidations = 0;
    const service = createTrustedUserIdentityService({
      getExecSql: () => execSql,
      getLocalUserId: () => null,
      getLocalIdentity: () => null,
      identityTrustDomain: LINK_TRUST_DOMAIN,
      remoteSource: {
        load: async () => remote,
        invalidate: () => {
          invalidations++;
        },
      },
    });
    try {
      let used = false;
      await expect(
        service.verifyLink(bob.link).then(() => {
          used = true;
        }),
      ).rejects.toThrow("do not match");
      expect(used).toBe(false);
      expect(invalidations).toBe(1);
      expect(
        await loadTrustedUserIdentityPin({
          execSql,
          identityTrustDomain: LINK_TRUST_DOMAIN,
          userId: LINK_USER_ID,
        }),
      ).toBeNull();
    } finally {
      close();
    }
  });
}

test("a valid link never overwrites a conflicting TOFU pin", async () => {
  const { close, execSql } = await createTestExecSql(
    "identity-link-existing-pin",
  );
  const [bob, previous] = await Promise.all([
    identityLinkFixture(1),
    identityLinkFixture(2),
  ]);
  let remote = previous.remote;
  const service = createTrustedUserIdentityService({
    getExecSql: () => execSql,
    getLocalUserId: () => null,
    getLocalIdentity: () => null,
    identityTrustDomain: LINK_TRUST_DOMAIN,
    remoteSource: { load: async () => remote, invalidate: () => {} },
  });
  try {
    await service.resolve(LINK_USER_ID);
    remote = bob.remote;
    await expect(service.verifyLink(bob.link)).rejects.toThrow(
      "Trusted user identity changed",
    );
    expect(
      await loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: LINK_TRUST_DOMAIN,
        userId: LINK_USER_ID,
      }),
    ).toMatchObject({
      signingKeyFingerprint: previous.remote.signingKeyFingerprint,
    });
  } finally {
    close();
  }
});

test("link creation uses local keys without fetching or trusting API identity rows", async () => {
  const { close, execSql } = await createTestExecSql("identity-link-local");
  const bob = await identityLinkFixture();
  const service = createTrustedUserIdentityService({
    getExecSql: () => execSql,
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
  try {
    expect(await service.createLink("https://app.example.test")).toBe(bob.link);
    expect(await service.createLink("https://app.example.test")).toBe(bob.link);
  } finally {
    close();
  }
});

test("foreign-service links fail before fetching; missing and changed-runtime identities never pin", async () => {
  const { close, execSql } = await createTestExecSql("identity-link-scope");
  const bob = await identityLinkFixture();
  let trustDomain = "https://other-api.example.test";
  let localId: string | null = null;
  let remote: RemoteUserIdentityCandidate | null = null;
  let changeIdentity = false;
  let loads = 0;
  const create = () =>
    createTrustedUserIdentityService({
      getExecSql: () => execSql,
      getLocalUserId: () => localId,
      getLocalIdentity: () => null,
      identityTrustDomain: trustDomain,
      remoteSource: {
        load: async () => {
          loads++;
          if (changeIdentity) localId = LINK_USER_ID;
          return remote;
        },
        invalidate: () => {},
      },
    });
  try {
    await expect(create().verifyLink(bob.link)).rejects.toThrow(
      "different Tearleads service",
    );
    expect(loads).toBe(0);
    trustDomain = LINK_TRUST_DOMAIN;
    await expect(create().verifyLink(bob.link)).rejects.toThrow("unavailable");
    remote = bob.remote;
    changeIdentity = true;
    await expect(create().verifyLink(bob.link)).rejects.toThrow(
      "active identity changed",
    );
    expect(
      await loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: LINK_TRUST_DOMAIN,
        userId: LINK_USER_ID,
      }),
    ).toBeNull();
  } finally {
    close();
  }
});
