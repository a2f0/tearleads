import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  type ContainerKeyEpoch,
  readKeyingCanonicalJson,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type { OrganizationProvisioningRequest } from "@tearleads/validators/request";
import { z } from "zod";
import { storeVerifiedAccessManifestInTransaction } from "../../access/write/accessManifestStore";
import { storeVerifiedContainerKekStateInTransaction } from "../../access/write/containerKekStore";
import {
  readProjectionAccessEvent,
  readProjectionAccessManifest,
} from "../../keyingProjectionRecords";
import {
  parseProjection,
  projectionString,
} from "../../keyingProjectionSchemas";
import {
  containerKeyEpochSchema,
  containerKeyWrapSchema,
  containerUserRecipientKeySchema,
} from "../containers/mutations/shared/containerKekRecords";
import { assertPrincipalPoliciesCurrent } from "../containers/mutations/shared/principalPolicies";
import { OrganizationProvisioningError } from "./provisionOrganizationError";

interface RootContainerSigner {
  readonly fingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

function provisioningShapeError(
  message: string,
): OrganizationProvisioningError {
  return new OrganizationProvisioningError(message, 400);
}

const metadataDocumentIdClaimSchema = z.object({
  metadataDocumentId: projectionString,
});

function readInitialRootContainerMetadataDocumentId(
  input: OrganizationProvisioningRequest,
): string {
  const claim = metadataDocumentIdClaimSchema.safeParse(
    input.initialRootContainer.body,
  );
  return claim.success ? claim.data.metadataDocumentId : "";
}

function requireRootVerification<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: Error },
): T {
  if (result.ok) {
    return result.value;
  }

  throw new OrganizationProvisioningError(result.error.message, 400);
}

function assertInitialRootEventMatchesRegistration(input: {
  event: VerifiedAccessEvent;
  fingerprint: string;
  registration: OrganizationProvisioningRequest;
}): void {
  const { event, fingerprint, registration } = input;

  if (
    event.event.eventType !== "container.create" ||
    event.event.objectKind !== "container" ||
    event.event.objectId !== registration.rootContainerId ||
    event.event.organizationId !== registration.organizationId ||
    event.event.signerUserId !== registration.userId ||
    event.event.signerKeyFingerprint !== fingerprint
  ) {
    throw new OrganizationProvisioningError(
      "Initial root container event does not match registration",
      400,
    );
  }
}

function assertRootManifestMatchesRegistration(
  manifest: VerifiedContainerAccessManifest,
  input: OrganizationProvisioningRequest,
  metadataDocumentId: string,
): void {
  if (
    manifest.state.containerId !== input.rootContainerId ||
    manifest.state.organizationId !== input.organizationId ||
    manifest.state.parentContainerId !== null ||
    manifest.state.parentManifestHash !== null ||
    manifest.state.metadataDocumentId !== metadataDocumentId
  ) {
    throw new OrganizationProvisioningError(
      "Initial root container manifest does not match registration",
      400,
    );
  }
}

function assertInitialRootKek(
  request: OrganizationProvisioningRequest["initialRootContainer"],
  keyEpoch: ContainerKeyEpoch,
): void {
  if (keyEpoch.keyEpoch !== 1) {
    throw new OrganizationProvisioningError(
      "Initial root container KEK must start at epoch 1",
      400,
    );
  }
  if (request.predecessorBridge !== null) {
    throw new OrganizationProvisioningError(
      "Initial root container KEK cannot have a predecessor bridge",
      400,
    );
  }
  if (request.keyring !== null) {
    throw new OrganizationProvisioningError(
      "Initial root container KEK cannot have a keyring",
      400,
    );
  }
}

/**
 * Verifies the client-signed root container artifacts (access event, manifest,
 * KEK state) against the registration and persists them. Returns the root
 * metadata coordinates the root metadata document must match.
 */
export async function storeInitialRootContainer(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: RootContainerSigner,
): Promise<{
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string;
}> {
  const request = input.initialRootContainer;
  const keyEpoch: ContainerKeyEpoch = parseProjection(
    containerKeyEpochSchema,
    request.keyEpoch,
    "Initial root container key epoch",
    provisioningShapeError,
  );
  assertInitialRootKek(request, keyEpoch);
  const metadataDocumentId = readInitialRootContainerMetadataDocumentId(input);
  const principalPolicies = await assertPrincipalPoliciesCurrent(
    tx,
    request.principalPolicyRefs,
    { requesterUserId: input.userId },
  );

  const event = requireRootVerification(
    await verifySignedAccessEvent({
      body: readKeyingCanonicalJson(
        request.body,
        "Initial root container event body",
      ),
      event: readProjectionAccessEvent(
        request.event,
        "Initial root container event",
        provisioningShapeError,
      ),
      signerPublicKey: signer.signingPublicKey,
    }),
  );

  assertInitialRootEventMatchesRegistration({
    event,
    fingerprint: signer.fingerprint,
    registration: input,
  });

  const manifest = requireRootVerification(
    await verifyContainerAccessManifest({
      event,
      expectedManifestHash: request.expectedManifestHash,
      manifest: readProjectionAccessManifest(
        request.manifest,
        "Initial root container manifest",
        provisioningShapeError,
      ),
      parentContainerPath: [],
      principalPolicies,
      previousManifest: null,
    }),
  );

  assertRootManifestMatchesRegistration(manifest, input, metadataDocumentId);

  const kekState = requireRootVerification(
    await verifyContainerKekState({
      containerManifest: manifest,
      keyEpoch,
      userRecipientKeys: parseProjection(
        z.array(containerUserRecipientKeySchema),
        request.userRecipientKeys,
        "Initial root container user recipient keys",
        provisioningShapeError,
      ),
      wraps: parseProjection(
        z.array(containerKeyWrapSchema),
        request.wraps,
        "Initial root container wraps",
        provisioningShapeError,
      ),
      principalPolicies,
    }),
  );

  await storeVerifiedAccessManifestInTransaction(
    { verifiedManifest: manifest },
    tx,
  );
  await storeVerifiedContainerKekStateInTransaction(
    { keyring: null, predecessorBridge: null, verifiedState: kekState },
    tx,
  );
  return {
    metadataAccessEpoch: manifest.state.epoch,
    metadataAccessStateHash: manifest.manifestHash,
    metadataDocumentId: manifest.state.metadataDocumentId,
  };
}
