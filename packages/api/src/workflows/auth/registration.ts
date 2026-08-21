import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import { users } from "@symcrypt/api-shared/schema";
import { bytesToBase64 } from "@symcrypt/encoding";
import type { RegistrationRequest } from "@symcrypt/validators/request";
import {
  type OrganizationProvisioningSigner,
  provisionOrganizationInTransaction,
  toOrganizationProvisioningError,
} from "../organizations/provisionOrganization";
import { OrganizationProvisioningError } from "../organizations/provisionOrganizationError";
import { validateOrganizationProvisioningInput } from "../organizations/provisionOrganizationValidation";

export { OrganizationProvisioningError as RegistrationError };

/**
 * A user registers by bootstrapping their personal organization; the roster
 * derives its display name from the encrypted organization profile document, so
 * the server-side label is a fixed placeholder.
 */
const PERSONAL_ORGANIZATION_NAME = "Personal";

const DUPLICATE_FINGERPRINT_ERROR = "REGISTRATION_DUPLICATE_FINGERPRINT";

async function createRegisteredUser(
  tx: DatabaseTransaction,
  input: {
    encapsulationFingerprint: string;
    encapsulationKeyBytes: Uint8Array;
    fingerprint: string;
    ip: string | null;
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
  },
) {
  const signer: OrganizationProvisioningSigner = {
    encapsulationFingerprint: keyMaterial.encapsulationFingerprint,
    fingerprint: keyMaterial.fingerprint,
    signingPublicKey: keyMaterial.signingKeyBytes,
  };
  await validateOrganizationProvisioningInput(input, signer);
  try {
    const provisioned = await db.transaction((tx) =>
      provisionOrganizationInTransaction(tx, input, signer, {
        initialBilling: "trial",
        organizationName: PERSONAL_ORGANIZATION_NAME,
        onOrganizationRootCreated: async (organizationId) => {
          await createRegisteredUser(tx, {
            encapsulationFingerprint: keyMaterial.encapsulationFingerprint,
            encapsulationKeyBytes: keyMaterial.encapsulationKeyBytes,
            fingerprint: keyMaterial.fingerprint,
            ip: keyMaterial.ip ?? null,
            organizationId,
            signingKeyBytes: keyMaterial.signingKeyBytes,
            userId: input.userId,
          });
        },
      }),
    );
    return { userId: input.userId, ...provisioned };
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
