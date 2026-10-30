import { KeyingVerificationError } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  compareOrInsertTrustedUserIdentityPin,
  loadTrustedUserIdentityPin,
  loadTrustedUserIdForSigningKey,
  TrustedUserIdentityPinCorruptError,
  TrustedUserIdentityPinMismatchError,
  type TrustedUserIdentityPinProvenance,
} from "../persistence/trustedUserIdentityPinPersistence";
import { TrustedUserIdentityPinContentionError } from "../persistence/trustedUserIdentityPinTransaction";
import type { ExecSql } from "../sqlite/sqlSchema";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
import { UnverifiedUserIdentityError } from "./admission";
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
  readonly provenance: TrustedUserIdentityPinProvenance;
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
        provenance: input.provenance,
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

/**
 * The candidate for `userId` and where it came from: this device's own keys
 * (`self`) or the identity endpoint (`observed`). Provenance follows the
 * source, never the account that happens to be active once a lookup returns.
 */
async function resolveCandidate(
  dependencies: TrustedUserIdentityServiceDependencies,
  userId: string,
  identityTrustDomain: string,
): Promise<{
  readonly identity: ValidatedUserIdentityCandidate;
  readonly source: "self" | "observed";
} | null> {
  const localUserId = dependencies.getLocalUserId();
  if (userId === localUserId) {
    const localIdentity = dependencies.getLocalIdentity(userId);
    if (!localIdentity) {
      throw new KeyingVerificationError(
        "missing_dependency",
        "Authoritative local identity keys are unavailable",
      );
    }
    return {
      identity: await validateLocalUserIdentity({
        candidate: localIdentity,
        identityTrustDomain,
        userId,
      }),
      source: "self",
    };
  }

  const remoteIdentity = await dependencies.remoteSource.load(userId);
  return remoteIdentity
    ? {
        identity: await validateRemoteUserIdentity({
          candidate: remoteIdentity,
          identityTrustDomain,
          requestedUserId: userId,
        }),
        source: "observed",
      }
    : null;
}

/** The trust store and account a lookup started under must still be active. */
function assertResolutionScope(
  dependencies: TrustedUserIdentityServiceDependencies,
  scope: { readonly execSql: ExecSql; readonly localUserId: string | null },
  message: string,
): void {
  if (
    dependencies.getExecSql() !== scope.execSql ||
    dependencies.getLocalUserId() !== scope.localUserId
  ) {
    throw new DatabaseUnavailableError(message);
  }
}

async function pinIdentity(input: {
  readonly dependencies: TrustedUserIdentityServiceDependencies;
  readonly execSql: NonNullable<
    ReturnType<TrustedUserIdentityServiceDependencies["getExecSql"]>
  >;
  readonly identity: ValidatedUserIdentityCandidate;
  readonly provenance: TrustedUserIdentityPinProvenance;
}): Promise<TrustedUserIdentity> {
  await compareWithDurablePin({
    execSql: input.execSql,
    firstSeenAt: (input.dependencies.now?.() ?? new Date()).toISOString(),
    identity: input.identity,
    provenance: input.provenance,
  });
  return brandTrustedUserIdentity(input.identity);
}

/**
 * Read-only: the identity this trust store already pins for `userId` and how
 * it was established, or null. The stored keys must still match their stored
 * fingerprints. Never inserts, compares against or replaces a pin.
 */
async function loadPin(input: {
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly userId: string;
}): Promise<{
  readonly identity: TrustedUserIdentity;
  readonly provenance: TrustedUserIdentityPinProvenance;
} | null> {
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
  return {
    identity: brandTrustedUserIdentity({
      ...keys,
      identityTrustDomain: input.identityTrustDomain,
      userId: input.userId,
    }),
    provenance: pin.provenance,
  };
}

/** Read-only: the pinned identity for `userId` of any provenance, or null. */
export async function loadPinnedUserIdentity(input: {
  readonly execSql: ExecSql;
  readonly identityTrustDomain: string;
  readonly userId: string;
}): Promise<TrustedUserIdentity | null> {
  return (await loadPin(input))?.identity ?? null;
}

/** Compares an independently received link before pinning it as `link`. */
async function verifyIdentityLink(
  dependencies: TrustedUserIdentityServiceDependencies,
  link: string,
): Promise<TrustedUserIdentity> {
  const expectation = parseIdentityLink(link);
  const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
  if (expectation.identityTrustDomain !== identityTrustDomain) {
    throw new Error(
      "This identity link belongs to a different Tearleads service.",
    );
  }
  const localUserId = dependencies.getLocalUserId();
  try {
    const candidate = await resolveCandidate(
      dependencies,
      expectation.userId,
      identityTrustDomain,
    );
    if (!candidate)
      throw new Error("The identity in this link is unavailable.");
    await assertIdentityLinkMatches(expectation, candidate.identity);
    assertResolutionScope(
      dependencies,
      { execSql, localUserId },
      "The active identity changed. Open the identity link again.",
    );
    return await pinIdentity({
      dependencies,
      execSql,
      identity: candidate.identity,
      provenance: candidate.source === "self" ? "self" : "link",
    });
  } catch (error) {
    dependencies.remoteSource.invalidate(expectation.userId);
    throw error;
  }
}

function admissionScopeChanged(): DatabaseUnavailableError {
  return new DatabaseUnavailableError(
    "The active database changed while admitting this user. Try again.",
  );
}

/** Reads that admit a user: only `self` and `link` pins qualify. */
function verifiedPinReaders(
  dependencies: TrustedUserIdentityServiceDependencies,
): Pick<TrustedUserIdentityService, "resolveVerified" | "requireVerified"> {
  const resolveVerified = async (userId: string) => {
    const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
    const pin = await loadPin({ execSql, identityTrustDomain, userId });
    if (dependencies.getExecSql() !== execSql) throw admissionScopeChanged();
    return pin && pin.provenance !== "observed" ? pin.identity : null;
  };
  return {
    resolveVerified,
    async requireVerified(userId, admittingExecSql) {
      const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
      if (execSql !== admittingExecSql) throw admissionScopeChanged();
      const pin = await loadPin({ execSql, identityTrustDomain, userId });
      if (dependencies.getExecSql() !== execSql) throw admissionScopeChanged();
      if (!pin || pin.provenance === "observed") {
        throw new UnverifiedUserIdentityError(userId);
      }
      return pin.identity;
    },
  };
}

export function createTrustedUserIdentityService(
  dependencies: TrustedUserIdentityServiceDependencies,
): TrustedUserIdentityService {
  return {
    async resolvePinned(userId) {
      const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
      return loadPinnedUserIdentity({ execSql, identityTrustDomain, userId });
    },
    ...verifiedPinReaders(dependencies),
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
    verifyLink: (link) => verifyIdentityLink(dependencies, link),
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
      return pinIdentity({
        dependencies,
        execSql,
        identity,
        provenance: "self",
      });
    },
    async resolve(userId) {
      assertTrustedUserIdentityUserId(userId);
      const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
      const localUserId = dependencies.getLocalUserId();
      try {
        const candidate = await resolveCandidate(
          dependencies,
          userId,
          identityTrustDomain,
        );
        if (!candidate) {
          return null;
        }
        assertResolutionScope(
          dependencies,
          { execSql, localUserId },
          "The active identity changed while resolving this user.",
        );
        return await pinIdentity({
          dependencies,
          execSql,
          identity: candidate.identity,
          provenance: candidate.source,
        });
      } catch (error) {
        dependencies.remoteSource.invalidate(userId);
        throw error;
      }
    },
  };
}
