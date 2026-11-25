import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { bytesToBase64 } from "@tearleads/encoding";
import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
import type { RegistrationRequest } from "@tearleads/validators/request";
import type { RegistrationResponse } from "@tearleads/validators/response";
import { eq, sql } from "drizzle-orm";
import { reportBackgroundFailure } from "../../diagnostics/reportBackgroundFailure";
import { readCommitCheckpoint } from "../../documents/commitLsn";
import {
  type OrganizationProvisioningSigner,
  provisionOrganizationInTransaction,
  toOrganizationProvisioningError,
} from "../organizations/provisionOrganization";
import { OrganizationProvisioningError } from "../organizations/provisionOrganizationError";
import { validateOrganizationProvisioningInput } from "../organizations/provisionOrganizationValidation";

export { OrganizationProvisioningError as RegistrationError };

const DUPLICATE_FINGERPRINT_ERROR = "REGISTRATION_DUPLICATE_FINGERPRINT";

export const LEGAL_TERMS_OUTDATED_MESSAGE =
  "The Privacy Policy and Terms of Service have changed. Review and agree to the current revision, then register again.";

/**
 * A registration carries the legal terms revision its user agreed to, and
 * only the current one registers: an identity is never recorded as agreeing
 * to a revision that no longer governs the service.
 */
function requireCurrentLegalTerms(input: RegistrationRequest): void {
  if (input.acceptedLegalTermsVersion !== LEGAL_TERMS_VERSION) {
    throw new OrganizationProvisioningError(LEGAL_TERMS_OUTDATED_MESSAGE, 409);
  }
}

/**
 * Read after the registration committed, as a document create's seed reports
 * its position. The registration stands whatever this read does: a failure is
 * reported and answered with no position, which leaves the client to read its
 * seeded documents once, as without one. Only registration reports a
 * position: a new identity has no other device that could edit its seeded
 * documents before this one subscribes to them.
 */
async function readRegistrationCommitCheckpoint(
  db: ApiDatabase,
): Promise<Pick<RegistrationResponse, "commitLsn" | "commitLsnMode">> {
  try {
    return await readCommitCheckpoint(db);
  } catch (error) {
    reportBackgroundFailure(error);
    return { commitLsn: null, commitLsnMode: "tracked" };
  }
}

async function createRegisteredUser(
  tx: DatabaseTransaction,
  input: {
    encapsulationFingerprint: string;
    encapsulationKeyBytes: Uint8Array;
    fingerprint: string;
    ip: string | null;
    legalTermsVersion: string;
    organizationId: string;
    userId: string;
    signingKeyBytes: Uint8Array;
  },
) {
  const [user] = await tx
    .insert(users)
    .values({
      id: input.userId,
      fingerprint: input.fingerprint,
      signingPublicKey: bytesToBase64(input.signingKeyBytes),
      encapsulationPublicKey: bytesToBase64(input.encapsulationKeyBytes),
      encapsulationKeyFingerprint: input.encapsulationFingerprint,
      defaultOrganizationId: input.organizationId,
      registrationSourceIpAddress: input.ip,
      legalTermsVersion: input.legalTermsVersion,
      // The database clock, as for `createdAt`: the time the registration
      // carrying the agreement committed, not a client's claim of it.
      legalTermsAcceptedAt: sql`now()`,
    })
    .onConflictDoNothing({ target: users.fingerprint })
    .returning({ id: users.id });
  if (!user) {
    throw new Error(DUPLICATE_FINGERPRINT_ERROR);
  }
  return user;
}

export async function runRegistrationWorkflow(
  db: ApiDatabase,
  input: RegistrationRequest,
  keyMaterial: {
    readonly encapsulationFingerprint: string;
    readonly encapsulationKeyBytes: Uint8Array;
    readonly fingerprint: string;
    readonly ip?: string | null;
    readonly signingKeyBytes: Uint8Array;
    readonly identityTrustDomain: string;
  },
) {
  requireCurrentLegalTerms(input);
  const signer: OrganizationProvisioningSigner = {
    encapsulationFingerprint: keyMaterial.encapsulationFingerprint,
    fingerprint: keyMaterial.fingerprint,
    signingPublicKey: keyMaterial.signingKeyBytes,
  };
  await validateOrganizationProvisioningInput(input, signer);
  try {
    const provisioned = await db.transaction(async (tx) => {
      // A lost response can leave the browser retrying an already committed
      // registration with the same root ID. Check the key before provisioning.
      const [existingUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.fingerprint, keyMaterial.fingerprint))
        .limit(1);
      if (existingUser) {
        throw new Error(DUPLICATE_FINGERPRINT_ERROR);
      }
      return provisionOrganizationInTransaction(tx, input, signer, {
        initialBilling: "trial",
        identityTrustDomain: keyMaterial.identityTrustDomain,
        onOrganizationRootCreated: async (organizationId) => {
          await createRegisteredUser(tx, {
            encapsulationFingerprint: keyMaterial.encapsulationFingerprint,
            encapsulationKeyBytes: keyMaterial.encapsulationKeyBytes,
            fingerprint: keyMaterial.fingerprint,
            ip: keyMaterial.ip ?? null,
            legalTermsVersion: input.acceptedLegalTermsVersion,
            organizationId,
            signingKeyBytes: keyMaterial.signingKeyBytes,
            userId: input.userId,
          });
        },
      });
    });
    return {
      userId: input.userId,
      ...provisioned,
      commitCheckpoint: await readRegistrationCommitCheckpoint(db),
    };
  } catch (error) {
    const provisioningError = toOrganizationProvisioningError(error);
    if (provisioningError) {
      throw provisioningError;
    }
    throw error;
  }
}

export function isDuplicateRegistrationFingerprintError(
  error: unknown,
): boolean {
  return (
    error instanceof Error && error.message === DUPLICATE_FINGERPRINT_ERROR
  );
}
