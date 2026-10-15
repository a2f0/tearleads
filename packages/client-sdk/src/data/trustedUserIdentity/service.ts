import { KeyingVerificationError } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  compareOrInsertTrustedUserIdentityPin,
  loadTrustedUserIdentityPin,
  loadTrustedUserIdForSigningKey,
  TrustedUserIdentityPinCorruptError,
  TrustedUserIdentityPinMismatchError,
} from "../persistence/trustedUserIdentityPinPersistence";
import { TrustedUserIdentityPinContentionError } from "../persistence/trustedUserIdentityPinTransaction";
import type { ExecSql } from "../sqlite/sqlSchema";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
import {
  assertIdentityLinkMatches,
  createIdentityLink,
  parseIdentityLink,
} from "./identityLink";
import {
  brandTrustedUserIdentity,
  TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE,
  TRUSTED_USER_IDENTITY_FORMAT_VERSION,
  TRUSTED_USER_IDENTITY_SIGNING_SUITE,
  type TrustedUserIdentity,
  type TrustedUserIdentityService,
  type TrustedUserIdentityServiceDependencies,
  type ValidatedUserIdentityCandidate,
} from "./types";
import {
  assertTrustedUserIdentityUserId,
  validateLocalUserIdentity,
  validateRemoteUserIdentity,
  validateUserIdentityKeys,
} from "./validation";

function requireTrustDomain(
  dependencies: TrustedUserIdentityServiceDependencies,
): string {
  // A missing trust domain is a static misconfiguration and must stay loud.
  if (!dependencies.identityTrustDomain) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Trusted user identity resolution requires a stable API trust domain",
    );
  }
  return dependencies.identityTrustDomain;
}

function requireTrustStore(
  dependencies: TrustedUserIdentityServiceDependencies,
) {
  const identityTrustDomain = requireTrustDomain(dependencies);
  // An absent trust store is not: getExecSql() returns null exactly while the
  // database is not ready, which happens routinely when the runtime is swapped
  // under in-flight sync work. Callers that tolerate a vanishing database
  // discriminate on the error type, so this must not share the code above.
  const execSql = dependencies.getExecSql();
  if (!execSql) {
    throw new DatabaseUnavailableError(
      "Trusted user identity resolution requires a ready SQLite trust store",
    );
  }
  return { execSql, identityTrustDomain };
}

async function compareWithDurablePin(input: {
  readonly execSql: NonNullable<
    ReturnType<TrustedUserIdentityServiceDependencies["getExecSql"]>
  >;
  readonly firstSeenAt: string;
  readonly identity: ValidatedUserIdentityCandidate;
}): Promise<void> {
  try {
    await compareOrInsertTrustedUserIdentityPin({
      execSql: input.execSql,
      pin: {
        encapsulationKeyFingerprint: input.identity.encapsulationKeyFingerprint,
        encapsulationPublicKey: bytesToBase64(
          input.identity.encapsulationPublicKey,
        ),
        encapsulationSuite: TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE,
        firstSeenAt: input.firstSeenAt,
        formatVersion: TRUSTED_USER_IDENTITY_FORMAT_VERSION,
        identityTrustDomain: input.identity.identityTrustDomain,
        signingKeyFingerprint: input.identity.signingKeyFingerprint,
        signingPublicKey: bytesToBase64(input.identity.signingPublicKey),
        signingSuite: TRUSTED_USER_IDENTITY_SIGNING_SUITE,
        userId: input.identity.userId,
      },
    });
  } catch (error) {
    if (error instanceof TrustedUserIdentityPinMismatchError) {
      throw new KeyingVerificationError(
        "equivocation",
        error.existing.userId !== error.candidate.userId
          ? `Signing key for ${input.identity.userId} is already bound to ${error.existing.userId}`
          : `Trusted user identity changed for ${input.identity.userId}`,
      );
    }
    if (error instanceof TrustedUserIdentityPinCorruptError) {
      throw new KeyingVerificationError(
        "invalid_shape",
        `Trusted user identity pin is corrupt for ${input.identity.userId}`,
      );
    }
    if (error instanceof TrustedUserIdentityPinContentionError) {
      // Lock contention says nothing about the identity; the caller retries
      // once the trust store is free, so this must not be recordable evidence.
      throw new DatabaseUnavailableError(
        `Trusted user identity pin store is busy for ${input.identity.userId}`,
      );
    }
    throw error;
  }
}

async function resolveCandidate(
  dependencies: TrustedUserIdentityServiceDependencies,
  userId: string,
  identityTrustDomain: string,
): Promise<ValidatedUserIdentityCandidate | null> {
  const localUserId = dependencies.getLocalUserId();
  if (userId === localUserId) {
    const localIdentity = dependencies.getLocalIdentity(userId);
    if (!localIdentity) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Authoritative local identity keys are unavailable",
      );
    }
    return validateLocalUserIdentity({
      candidate: localIdentity,
      identityTrustDomain,
      userId,
    });
  }

  const remoteIdentity = await dependencies.remoteSource.load(userId);
  return remoteIdentity
    ? validateRemoteUserIdentity({
        candidate: remoteIdentity,
        identityTrustDomain,
        requestedUserId: userId,
      })
    : null;
}

async function pinIdentity(input: {
  readonly dependencies: TrustedUserIdentityServiceDependencies;
  readonly execSql: NonNullable<
    ReturnType<TrustedUserIdentityServiceDependencies["getExecSql"]>
  >;
  readonly identity: ValidatedUserIdentityCandidate;
}): Promise<TrustedUserIdentity> {
  await compareWithDurablePin({
    execSql: input.execSql,
    firstSeenAt: (input.dependencies.now?.() ?? new Date()).toISOString(),
    identity: input.identity,
  });
  return brandTrustedUserIdentity(input.identity);
}

/**
 * Read-only: the identity this trust store already pins for `userId`, or null.
 * The stored keys must still match their stored fingerprints. Never inserts,
 * compares against or replaces a pin.
 */
export async function loadPinnedUserIdentity(input: {
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly userId: string;
}): Promise<TrustedUserIdentity | null> {
  assertTrustedUserIdentityUserId(input.userId);
  const pin = await loadTrustedUserIdentityPin(input);
  if (!pin) return null;
  const keys = await validateUserIdentityKeys({
    candidate: {
      encapsulationPublicKey: base64ToBytes(pin.encapsulationPublicKey),
      signingKeyFingerprint: pin.signingKeyFingerprint,
      signingPublicKey: base64ToBytes(pin.signingPublicKey),
    },
    encapsulationKeyFingerprint: pin.encapsulationKeyFingerprint,
  });
  return brandTrustedUserIdentity({
    ...keys,
    identityTrustDomain: input.identityTrustDomain,
    userId: input.userId,
  });
}

export function createTrustedUserIdentityService(
  dependencies: TrustedUserIdentityServiceDependencies,
): TrustedUserIdentityService {
  return {
    async resolvePinned(userId) {
      const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
      return loadPinnedUserIdentity({ execSql, identityTrustDomain, userId });
    },
    async createLink(appUrl) {
      const identityTrustDomain = requireTrustDomain(dependencies);
      const userId = dependencies.getLocalUserId();
      const candidate = userId ? dependencies.getLocalIdentity(userId) : null;
      if (!userId || !candidate) {
        throw new Error("Sign in before sharing your identity link.");
      }
      const identity = await validateLocalUserIdentity({
        candidate,
        identityTrustDomain,
        userId,
      });
      return createIdentityLink(identity, appUrl);
    },
    async verifyLink(link) {
      const expectation = parseIdentityLink(link);
      const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
      if (expectation.identityTrustDomain !== identityTrustDomain) {
        throw new Error(
          "This identity link belongs to a different Tearleads service.",
        );
      }
      const localUserId = dependencies.getLocalUserId();
      try {
        const identity = await resolveCandidate(
          dependencies,
          expectation.userId,
          identityTrustDomain,
        );
        if (!identity)
          throw new Error("The identity in this link is unavailable.");
        await assertIdentityLinkMatches(expectation, identity);
        if (
          dependencies.getExecSql() !== execSql ||
          dependencies.getLocalUserId() !== localUserId
        ) {
          throw new DatabaseUnavailableError(
            "The active identity changed. Open the identity link again.",
          );
        }
        return await pinIdentity({ dependencies, execSql, identity });
      } catch (error) {
        dependencies.remoteSource.invalidate(expectation.userId);
        throw error;
      }
    },
    async boundUserId(signingKeyFingerprint) {
      const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
      return loadTrustedUserIdForSigningKey({
        execSql,
        identityTrustDomain,
        signingKeyFingerprint,
      });
    },
    async pinLocal(userId, candidate) {
      assertTrustedUserIdentityUserId(userId);
      const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
      const identity = await validateLocalUserIdentity({
        candidate,
        identityTrustDomain,
        userId,
      });
      return pinIdentity({ dependencies, execSql, identity });
    },
    async resolve(userId) {
      assertTrustedUserIdentityUserId(userId);
      const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
      try {
        const identity = await resolveCandidate(
          dependencies,
          userId,
          identityTrustDomain,
        );
        if (!identity) {
          return null;
        }
        return await pinIdentity({ dependencies, execSql, identity });
      } catch (error) {
        dependencies.remoteSource.invalidate(userId);
        throw error;
      }
    },
  };
}
