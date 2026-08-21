import { KeyingVerificationError } from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  compareOrInsertTrustedUserIdentityPin,
  TrustedUserIdentityPinCorruptError,
  TrustedUserIdentityPinMismatchError,
} from "../persistence/trustedUserIdentityPinPersistence";
import { TrustedUserIdentityPinContentionError } from "../persistence/trustedUserIdentityPinTransaction";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
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

function requireTrustStore(
  dependencies: TrustedUserIdentityServiceDependencies,
): {
  readonly execSql: NonNullable<
    ReturnType<TrustedUserIdentityServiceDependencies["getExecSql"]>
  >;
  readonly identityTrustDomain: string;
} {
  // A missing trust domain is a static misconfiguration and must stay loud.
  if (!dependencies.identityTrustDomain) {
    throw new KeyingVerificationError(
      "missing_dependency",
      "Trusted user identity resolution requires a stable API trust domain",
    );
  }
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
  return { execSql, identityTrustDomain: dependencies.identityTrustDomain };
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
        `Trusted user identity changed for ${input.identity.userId}`,
      );
    }
    if (error instanceof TrustedUserIdentityPinCorruptError) {
      throw new KeyingVerificationError(
        "invalid_shape",
        `Trusted user identity pin is corrupt for ${input.identity.userId}`,
      );
    }
    if (error instanceof TrustedUserIdentityPinContentionError) {
      throw new KeyingVerificationError(
        "missing_dependency",
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

export function createTrustedUserIdentityService(
  dependencies: TrustedUserIdentityServiceDependencies,
): TrustedUserIdentityService {
  return {
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
