import { expect, test } from "bun:test";
import {
  generateKemKeyPair,
  generateSigningKeyPair,
  KeyingVerificationError,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { loadTrustedUserIdentityPin } from "../persistence/trustedUserIdentityPinPersistence";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
import { createTrustedUserIdentityService } from "./service";
import type {
  LocalUserIdentityCandidate,
  RemoteUserIdentityCandidate,
  TrustedUserIdentityServiceDependencies,
} from "./types";
import { isTrustedUserIdentity } from "./types";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRUST_DOMAIN = "https://api.example.test/v1";

async function createCandidate(seed: number): Promise<{
  readonly local: LocalUserIdentityCandidate;
  readonly remote: RemoteUserIdentityCandidate;
}> {
  const signingKeyPair = generateSigningKeyPair(new Uint8Array(32).fill(seed));
  const encapsulationKeyPair = generateKemKeyPair(
    new Uint8Array(64).fill(seed),
  );
  const [signingKeyFingerprint, encapsulationKeyFingerprint] =
    await Promise.all([
      toFingerprint(signingKeyPair.signingPublicKey),
      toFingerprint(encapsulationKeyPair.publicKey),
    ]);
  return {
    local: {
      encapsulationPublicKey: encapsulationKeyPair.publicKey,
      signingKeyFingerprint,
      signingPublicKey: signingKeyPair.signingPublicKey,
    },
    remote: {
      encapsulationKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
      signingKeyFingerprint,
      signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
      userId: USER_ID,
    },
  };
}

function dependencies(input: {
  readonly execSql: TrustedUserIdentityServiceDependencies["getExecSql"];
  readonly invalidations?: string[] | undefined;
  readonly local?: LocalUserIdentityCandidate | null | undefined;
  readonly localUserId?: string | null | undefined;
  readonly remote: RemoteUserIdentityCandidate | null;
  readonly remoteLoads?: string[] | undefined;
}): TrustedUserIdentityServiceDependencies {
  return {
    getExecSql: input.execSql,
    getLocalIdentity: () => input.local ?? null,
    getLocalUserId: () => input.localUserId ?? null,
    identityTrustDomain: TRUST_DOMAIN,
    now: () => new Date("2026-07-15T12:00:00.000Z"),
    remoteSource: {
      invalidate: (userId) => input.invalidations?.push(userId),
      load: async (userId) => {
        input.remoteLoads?.push(userId);
        return input.remote;
      },
    },
  };
}

test("trusted identity service validates and pins the complete remote bundle", async () => {
  const { close, execSql } = await createTestExecSql("identity-service-pin");
  const candidate = await createCandidate(1);
  const service = createTrustedUserIdentityService(
    dependencies({ execSql: () => execSql, remote: candidate.remote }),
  );

  try {
    const resolved = await service.resolve(USER_ID);
    expect(isTrustedUserIdentity(resolved)).toBe(true);
    expect(resolved).toMatchObject({
      encapsulationKeyFingerprint: candidate.remote.encapsulationKeyFingerprint,
      identityTrustDomain: TRUST_DOMAIN,
      signingKeyFingerprint: candidate.remote.signingKeyFingerprint,
      userId: USER_ID,
    });
    await expect(
      loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: TRUST_DOMAIN,
        userId: USER_ID,
      }),
    ).resolves.toMatchObject({
      encapsulationPublicKey: candidate.remote.encapsulationPublicKey,
      firstSeenAt: "2026-07-15T12:00:00.000Z",
      signingPublicKey: candidate.remote.signingPublicKey,
    });
  } finally {
    close();
  }
});

test("same signing key with a substituted KEM key is typed equivocation", async () => {
  const { close, execSql } = await createTestExecSql(
    "identity-service-kem-substitution",
  );
  const first = await createCandidate(2);
  const second = await createCandidate(3);
  const firstService = createTrustedUserIdentityService(
    dependencies({ execSql: () => execSql, remote: first.remote }),
  );

  try {
    await firstService.resolve(USER_ID);
    const substituted = {
      ...first.remote,
      encapsulationKeyFingerprint: second.remote.encapsulationKeyFingerprint,
      encapsulationPublicKey: second.remote.encapsulationPublicKey,
    };
    const invalidations: string[] = [];
    const nextService = createTrustedUserIdentityService(
      dependencies({
        execSql: () => execSql,
        invalidations,
        remote: substituted,
      }),
    );
    let thrown: unknown;
    try {
      await nextService.resolve(USER_ID);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(KeyingVerificationError);
    expect(thrown).toMatchObject({ code: "equivocation" });
    expect(invalidations).toEqual([USER_ID]);
  } finally {
    close();
  }
});

test("authoritative self resolution never consults the remote source", async () => {
  const { close, execSql } = await createTestExecSql("identity-service-self");
  const local = await createCandidate(4);
  const remote = await createCandidate(5);
  const remoteLoads: string[] = [];
  const service = createTrustedUserIdentityService(
    dependencies({
      execSql: () => execSql,
      local: local.local,
      localUserId: USER_ID,
      remote: remote.remote,
      remoteLoads,
    }),
  );

  try {
    const resolved = await service.resolve(USER_ID);
    expect(remoteLoads).toEqual([]);
    expect(bytesToBase64(resolved?.signingPublicKey ?? new Uint8Array())).toBe(
      local.remote.signingPublicKey,
    );
  } finally {
    close();
  }
});

test("local identity can be pinned before session publication", async () => {
  const { close, execSql } = await createTestExecSql(
    "identity-service-pre-session-self",
  );
  const local = await createCandidate(12);
  const remoteLoads: string[] = [];
  const service = createTrustedUserIdentityService(
    dependencies({
      execSql: () => execSql,
      local: local.local,
      localUserId: null,
      remote: local.remote,
      remoteLoads,
    }),
  );

  try {
    await expect(service.pinLocal(USER_ID, local.local)).resolves.toMatchObject(
      {
        userId: USER_ID,
      },
    );
    expect(remoteLoads).toEqual([]);
  } finally {
    close();
  }
});

test("authoritative self identity must match an existing durable pin", async () => {
  const { close, execSql } = await createTestExecSql(
    "identity-service-self-mismatch",
  );
  const first = await createCandidate(8);
  const local = await createCandidate(9);
  const remoteLoads: string[] = [];

  try {
    await createTrustedUserIdentityService(
      dependencies({ execSql: () => execSql, remote: first.remote }),
    ).resolve(USER_ID);
    const localService = createTrustedUserIdentityService(
      dependencies({
        execSql: () => execSql,
        local: local.local,
        localUserId: USER_ID,
        remote: first.remote,
        remoteLoads,
      }),
    );

    await expect(localService.resolve(USER_ID)).rejects.toMatchObject({
      code: "equivocation",
    });
    expect(remoteLoads).toEqual([]);
  } finally {
    close();
  }
});

test("invalid key material fails before any pin is written", async () => {
  const { close, execSql } = await createTestExecSql(
    "identity-service-invalid-key",
  );
  const candidate = await createCandidate(6);
  const service = createTrustedUserIdentityService(
    dependencies({
      execSql: () => execSql,
      remote: { ...candidate.remote, encapsulationPublicKey: "not-base64" },
    }),
  );

  try {
    await expect(service.resolve(USER_ID)).rejects.toMatchObject({
      code: "invalid_shape",
    });
    await expect(
      loadTrustedUserIdentityPin({
        execSql,
        identityTrustDomain: TRUST_DOMAIN,
        userId: USER_ID,
      }),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("missing trust store fails closed before remote loading", async () => {
  const candidate = await createCandidate(7);
  const remoteLoads: string[] = [];
  const service = createTrustedUserIdentityService(
    dependencies({
      execSql: () => null,
      remote: candidate.remote,
      remoteLoads,
    }),
  );

  // A transient condition, so it carries its own type rather than a keying code
  // — but it must still fail closed: no remote load without a trust store.
  await expect(service.resolve(USER_ID)).rejects.toBeInstanceOf(
    DatabaseUnavailableError,
  );
  expect(remoteLoads).toEqual([]);
});

test("missing trust domain fails closed before remote loading", async () => {
  const candidate = await createCandidate(10);
  const remoteLoads: string[] = [];
  const configured = dependencies({
    execSql: () => {
      throw new Error("Trust store must not be read without a trust domain");
    },
    remote: candidate.remote,
    remoteLoads,
  });
  const service = createTrustedUserIdentityService({
    ...configured,
    identityTrustDomain: null,
  });

  await expect(service.resolve(USER_ID)).rejects.toMatchObject({
    code: "missing_dependency",
  });
  expect(remoteLoads).toEqual([]);
});

test("uppercase UUID aliases are rejected before lookup or pinning", async () => {
  const { close, execSql } = await createTestExecSql(
    "identity-service-canonical-user-id",
  );
  const candidate = await createCandidate(11);
  const remoteLoads: string[] = [];
  const service = createTrustedUserIdentityService(
    dependencies({
      execSql: () => execSql,
      remote: candidate.remote,
      remoteLoads,
    }),
  );

  try {
    await service.resolve(USER_ID);
    await expect(service.resolve(USER_ID.toUpperCase())).rejects.toMatchObject({
      code: "invalid_shape",
    });
    expect(remoteLoads).toEqual([USER_ID]);
    await expect(
      execSql("SELECT user_id FROM trusted_user_identity_pins"),
    ).resolves.toEqual([{ user_id: USER_ID }]);
  } finally {
    close();
  }
});
