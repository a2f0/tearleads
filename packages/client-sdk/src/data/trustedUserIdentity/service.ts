import { KeyingVerificationError } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  TrustedUserIdentityPinCorruptError,
  TrustedUserIdentityPinMismatchError,
} from "../persistence/identity/trustedUserIdentityPinModel";
import { loadTrustedUserIdForSigningKey } from "../persistence/identity/trustedUserIdentitySigningKeyBinding";
import {
  compareOrInsertTrustedUserIdentityPins,
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
import { loadPin, loadPinnedUserIdentity } from "./pinnedIdentity";
import { withPinnedIdentityResolution } from "./pinnedResolution";
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

function durablePin(
  identity: ValidatedUserIdentityCandidate,
  provenance: TrustedUserIdentityPinProvenance,
  firstSeenAt: string,
) {
  return {
    encapsulationKeyFingerprint: identity.encapsulationKeyFingerprint,
    encapsulationPublicKey: bytesToBase64(identity.encapsulationPublicKey),
    encapsulationSuite: TRUSTED_USER_IDENTITY_ENCAPSULATION_SUITE,
    firstSeenAt,
    provenance,
    formatVersion: TRUSTED_USER_IDENTITY_FORMAT_VERSION,
    identityTrustDomain: identity.identityTrustDomain,
    signingKeyFingerprint: identity.signingKeyFingerprint,
    signingPublicKey: bytesToBase64(identity.signingPublicKey),
    signingSuite: TRUSTED_USER_IDENTITY_SIGNING_SUITE,
    userId: identity.userId,
  };
}

/** Compare-or-insert every identity in one transaction: all pin, or none. */
async function compareWithDurablePins(input: {
  readonly assertCurrent?: (() => void) | undefined;
  readonly execSql: NonNullable<
    ReturnType<TrustedUserIdentityServiceDependencies["getExecSql"]>
  >;
  readonly firstSeenAt: string;
  readonly identities: readonly ValidatedUserIdentityCandidate[];
  readonly provenance: TrustedUserIdentityPinProvenance;
}): Promise<void> {
  const userIds = input.identities.map((identity) => identity.userId);
  try {
    await compareOrInsertTrustedUserIdentityPins({
      assertCurrent: input.assertCurrent,
      execSql: input.execSql,
      pins: input.identities.map((identity) =>
        durablePin(identity, input.provenance, input.firstSeenAt),
      ),
    });
  } catch (error) {
    if (error instanceof TrustedUserIdentityPinMismatchError) {
      throw new KeyingVerificationError(
        "equivocation",
        error.existing.userId !== error.candidate.userId
          ? `Signing key for ${error.candidate.userId} is already bound to ${error.existing.userId}`
          : `Trusted user identity changed for ${error.candidate.userId}`,
      );
    }
    if (error instanceof TrustedUserIdentityPinCorruptError) {
      throw new KeyingVerificationError(
        "invalid_shape",
        `Trusted user identity pin is corrupt for ${error.userId}`,
      );
    }
    if (error instanceof TrustedUserIdentityPinContentionError) {
      // Lock contention says nothing about the identity; the caller retries
      // once the trust store is free, so this must not be recordable evidence.
      throw new DatabaseUnavailableError(
        `Trusted user identity pin store is busy for ${userIds.join(", ")}`,
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

  const identity = await loadRemoteCandidate(
    dependencies,
    userId,
    identityTrustDomain,
  );
  return identity ? { identity, source: "observed" } : null;
}

async function loadRemoteCandidate(
  dependencies: TrustedUserIdentityServiceDependencies,
  userId: string,
  identityTrustDomain: string,
): Promise<ValidatedUserIdentityCandidate | null> {
  const remoteIdentity = await dependencies.remoteSource.load(userId);
  return remoteIdentity
    ? validateRemoteUserIdentity({
        candidate: remoteIdentity,
        identityTrustDomain,
        requestedUserId: userId,
      })
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
  /** Checked inside the pin's write transaction, before it commits. */
  readonly assertCurrent?: (() => void) | undefined;
  readonly dependencies: TrustedUserIdentityServiceDependencies;
  readonly execSql: NonNullable<
    ReturnType<TrustedUserIdentityServiceDependencies["getExecSql"]>
  >;
  readonly identity: ValidatedUserIdentityCandidate;
  readonly provenance: TrustedUserIdentityPinProvenance;
}): Promise<TrustedUserIdentity> {
  await compareWithDurablePins({
    assertCurrent: input.assertCurrent,
    execSql: input.execSql,
    firstSeenAt: (input.dependencies.now?.() ?? new Date()).toISOString(),
    identities: [input.identity],
    provenance: input.provenance,
  });
  return brandTrustedUserIdentity(input.identity);
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
    const assertCurrent = () =>
      assertResolutionScope(
        dependencies,
        { execSql, localUserId },
        "The active identity changed. Open the identity link again.",
      );
    assertCurrent();
    return await pinIdentity({
      assertCurrent,
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
): Pick<
  TrustedUserIdentityService,
  "loadAdmissionPin" | "resolveVerified" | "requireVerified"
> {
  const resolveVerified = async (userId: string) => {
    const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
    const pin = await loadPin({ execSql, identityTrustDomain, userId });
    if (dependencies.getExecSql() !== execSql) throw admissionScopeChanged();
    return pin && pin.provenance !== "observed" ? pin.identity : null;
  };
  // The pin in the trust store of the database the admission captured.
  const loadAdmittingPin = async (
    userId: string,
    admittingExecSql: ExecSql | null,
  ) => {
    const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
    if (execSql !== admittingExecSql) throw admissionScopeChanged();
    const pin = await loadPin({ execSql, identityTrustDomain, userId });
    if (dependencies.getExecSql() !== execSql) throw admissionScopeChanged();
    return pin;
  };
  return {
    resolveVerified,
    async requireVerified(userId, admittingExecSql) {
      const pin = await loadAdmittingPin(userId, admittingExecSql);
      if (!pin || pin.provenance === "observed") {
        throw new UnverifiedUserIdentityError(userId);
      }
      return pin.identity;
    },
    async loadAdmissionPin(userId, admittingExecSql) {
      const pin = await loadAdmittingPin(userId, admittingExecSql);
      return pin
        ? { identity: pin.identity, verified: pin.provenance !== "observed" }
        : null;
    },
  };
}

/** This user's own link, derived exclusively from this device's local keys. */
async function createLocalIdentityLink(
  dependencies: TrustedUserIdentityServiceDependencies,
  appUrl: string,
): Promise<string> {
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
}

export function createTrustedUserIdentityService(
  dependencies: TrustedUserIdentityServiceDependencies,
): TrustedUserIdentityService {
  const verifiedReaders = verifiedPinReaders(dependencies);
  return {
    async resolvePinned(userId) {
      const { execSql, identityTrustDomain } = requireTrustStore(dependencies);
      return loadPinnedUserIdentity({ execSql, identityTrustDomain, userId });
    },
    ...verifiedReaders,
    createLink: (appUrl) => createLocalIdentityLink(dependencies, appUrl),
    async createLinkFor(userId, appUrl) {
      if (
        userId === dependencies.getLocalUserId() &&
        dependencies.getLocalIdentity(userId)
      ) {
        return createLocalIdentityLink(dependencies, appUrl);
      }
      // Only a `link` or `self` pin: re-sharing an observed (TOFU) key as a
      // link would let its recipient pin an unverified key as `link`.
      const identity = await verifiedReaders.resolveVerified(userId);
      return identity ? createIdentityLink(identity, appUrl) : null;
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
    resolve: withPinnedIdentityResolution(
      dependencies,
      async (userId) => {
        assertTrustedUserIdentityUserId(userId);
        const { execSql, identityTrustDomain } =
          requireTrustStore(dependencies);
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
          const assertCurrent = () =>
            assertResolutionScope(
              dependencies,
              { execSql, localUserId },
              "The active identity changed while resolving this user.",
            );
          assertCurrent();
          return await pinIdentity({
            assertCurrent,
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
      {
        loadCandidate: (userId, identityTrustDomain) =>
          loadRemoteCandidate(dependencies, userId, identityTrustDomain),
        pinObserved: (execSql, identities, assertCurrent) =>
          compareWithDurablePins({
            assertCurrent,
            execSql,
            firstSeenAt: (dependencies.now?.() ?? new Date()).toISOString(),
            identities,
            provenance: "observed",
          }),
      },
    ),
  };
}
