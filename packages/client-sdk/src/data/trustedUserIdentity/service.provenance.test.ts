import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPin } from "../../../test/helpers/trustedUserIdentityPin";
import {
  compareOrInsertTrustedUserIdentityPin,
  loadTrustedUserIdentityPin,
  TrustedUserIdentityPinMismatchError,
} from "../persistence/trustedUserIdentityPinPersistence";
import { UnverifiedUserIdentityError } from "./admission";
import {
  identityLinkFixture,
  LINK_TRUST_DOMAIN,
  LINK_USER_ID,
} from "./identityLink.testFixtures";
import { createTrustedUserIdentityService } from "./service";
import type { RemoteUserIdentityCandidate } from "./types";

function serviceFor(
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  remote: RemoteUserIdentityCandidate,
) {
  return createTrustedUserIdentityService({
    getExecSql: () => execSql,
    getLocalUserId: () => null,
    getLocalIdentity: () => null,
    identityTrustDomain: LINK_TRUST_DOMAIN,
    remoteSource: { invalidate: () => {}, load: async () => remote },
  });
}

async function storedProvenance(
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
) {
  const pin = await loadTrustedUserIdentityPin({
    execSql,
    identityTrustDomain: LINK_TRUST_DOMAIN,
    userId: LINK_USER_ID,
  });
  return pin?.provenance ?? null;
}

test("a pin observed on first sight cannot admit, and a matching link upgrades it for good", async () => {
  const { close, execSql } = await createTestExecSql("pin-provenance-upgrade");
  const fixture = await identityLinkFixture();
  const service = serviceFor(execSql, fixture.remote);
  try {
    const observed = await service.resolve(LINK_USER_ID);
    expect(observed?.signingKeyFingerprint).toBe(
      fixture.remote.signingKeyFingerprint,
    );
    expect(await storedProvenance(execSql)).toBe("observed");
    expect(await service.resolvePinned(LINK_USER_ID)).toEqual(observed);
    expect(await service.resolveVerified(LINK_USER_ID)).toBeNull();
    await expect(service.requireVerified(LINK_USER_ID)).rejects.toBeInstanceOf(
      UnverifiedUserIdentityError,
    );

    const linked = await service.verifyLink(fixture.link);
    expect(await storedProvenance(execSql)).toBe("link");
    expect(await service.resolveVerified(LINK_USER_ID)).toEqual(linked);
    expect(await service.requireVerified(LINK_USER_ID)).toEqual(linked);

    // A later first-sight resolution of the same keys never lowers it.
    await service.resolve(LINK_USER_ID);
    expect(await storedProvenance(execSql)).toBe("link");
  } finally {
    close();
  }
});

test("an unpinned user is unverified", async () => {
  const { close, execSql } = await createTestExecSql("pin-provenance-absent");
  const fixture = await identityLinkFixture();
  const service = serviceFor(execSql, fixture.remote);
  try {
    expect(await service.resolveVerified(LINK_USER_ID)).toBeNull();
    const refusal = await service
      .requireVerified(LINK_USER_ID)
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(UnverifiedUserIdentityError);
    expect(refusal).toMatchObject({
      code: "user_identity_unverified",
      userId: LINK_USER_ID,
    });
    expect(await storedProvenance(execSql)).toBeNull();
  } finally {
    close();
  }
});

test("the user's own keys pin as self", async () => {
  const { close, execSql } = await createTestExecSql("pin-provenance-self");
  const fixture = await identityLinkFixture();
  const service = serviceFor(execSql, fixture.remote);
  try {
    await service.pinLocal(LINK_USER_ID, fixture.local);
    expect(await storedProvenance(execSql)).toBe("self");
    expect(await service.resolveVerified(LINK_USER_ID)).not.toBeNull();
    await service.verifyLink(fixture.link);
    expect(await storedProvenance(execSql)).toBe("self");
  } finally {
    close();
  }
});

test("provenance never rises past a key mismatch", async () => {
  const { close, execSql } = await createTestExecSql("pin-provenance-mismatch");
  const observed = createPin({ provenance: "observed" });
  try {
    await compareOrInsertTrustedUserIdentityPin({ execSql, pin: observed });
    await expect(
      compareOrInsertTrustedUserIdentityPin({
        execSql,
        pin: createPin({
          provenance: "link",
          signingPublicKey: "signing-public-key-b",
        }),
      }),
    ).rejects.toBeInstanceOf(TrustedUserIdentityPinMismatchError);
    expect(
      (await loadTrustedUserIdentityPin({ execSql, ...observed }))?.provenance,
    ).toBe("observed");

    const linked = await compareOrInsertTrustedUserIdentityPin({
      execSql,
      pin: createPin({ provenance: "link" }),
    });
    expect(linked.provenance).toBe("link");
    const later = await compareOrInsertTrustedUserIdentityPin({
      execSql,
      pin: createPin({ provenance: "observed" }),
    });
    expect(later).toMatchObject({ provenance: "link" });
    expect(later.firstSeenAt).toBe(observed.firstSeenAt);
  } finally {
    close();
  }
});

test("a pin table without provenance is an obsolete local database", async () => {
  const { close, execSql } = await createTestExecSql("pin-provenance-obsolete");
  try {
    await execSql(
      `CREATE TABLE "trusted_user_identity_pins" ("identity_trust_domain" TEXT NOT NULL, "user_id" TEXT NOT NULL, "format_version" INTEGER NOT NULL, "signing_suite" TEXT NOT NULL, "signing_public_key" TEXT NOT NULL, "signing_key_fingerprint" TEXT NOT NULL, "encapsulation_suite" TEXT NOT NULL, "encapsulation_public_key" TEXT NOT NULL, "encapsulation_key_fingerprint" TEXT NOT NULL, "first_seen_at" TEXT NOT NULL, PRIMARY KEY ("identity_trust_domain", "user_id"))`,
    );
    await expect(
      loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: LINK_TRUST_DOMAIN,
        userId: LINK_USER_ID,
      }),
    ).rejects.toThrow("reset the local database");
  } finally {
    close();
  }
});
