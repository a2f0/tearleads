import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { OrganizationProvisioningRequest } from "@tearleads/validators/request";
import {
  type OrganizationReplacementAuthorization,
  OrganizationReplacementAuthorizationSchema,
} from "@tearleads/validators/util";
import { KeyingVerificationError } from "./keying/verificationError";
import { computePrincipalStateHash } from "./principalState";
import type { SigningKeyPair } from "./signing/generateKeyPair";
import { sign } from "./signing/sign";
import { verify } from "./signing/verify";

type AuthorizationPayload = Omit<
  OrganizationReplacementAuthorization,
  "signature"
>;
export type OrganizationReplacementProvisioningInput = Pick<
  OrganizationProvisioningRequest,
  | "organizationId"
  | "rootContainerId"
  | "userId"
  | "initialOrganizationPolicy"
  | "initialAdminGroup"
  | "initialMemberGroup"
  | "initialRootContainer"
> & { readonly replacesOrganizationId: string };

const VERIFIED_REPLACEMENT = Symbol("verified-organization-replacement");
export interface VerifiedOrganizationReplacementAuthorization
  extends OrganizationReplacementAuthorization {
  readonly [VERIFIED_REPLACEMENT]: true;
}

function invalid(message: string): never {
  throw new KeyingVerificationError("object_mismatch", message);
}

function assertPersonalGenesis(
  input: OrganizationReplacementProvisioningInput,
): string {
  if (input.organizationId === input.replacesOrganizationId)
    invalid("A replacement must create a fresh organization");
  for (const [principalType, principalId, policy] of [
    ["organization", input.organizationId, input.initialOrganizationPolicy],
    [
      "group",
      input.initialAdminGroup.groupId,
      input.initialAdminGroup.initialGroupPolicy,
    ],
    [
      "group",
      input.initialMemberGroup.groupId,
      input.initialMemberGroup.initialGroupPolicy,
    ],
  ] as const) {
    const { state, projection } = policy;
    if (
      state.principalType !== principalType ||
      state.principalId !== principalId ||
      state.version !== 1 ||
      state.prevStateHash !== null ||
      state.keyEpoch !== 1 ||
      state.signerUserId !== input.userId ||
      state.memberCount !== 1 ||
      projection.length !== 1 ||
      projection[0]?.userId !== input.userId ||
      projection[0]?.role !== "admin"
    )
      invalid(
        "A replacement must begin with the founding user as sole authority",
      );
  }
  const { body, event, manifest } = input.initialRootContainer;
  if (!isPlainObject(body)) invalid("Replacement root body is invalid");
  const metadataDocumentId: unknown = Reflect.get(body, "metadataDocumentId");
  const grants: unknown = Reflect.get(body, "directGrants");
  const onlyGrant =
    Array.isArray(grants) && grants.length === 1 ? grants[0] : null;
  if (
    Reflect.get(body, "eventType") !== "container.create" ||
    Reflect.get(body, "parentContainerId") !== null ||
    Reflect.get(body, "parentManifestHash") !== null ||
    Reflect.get(body, "systemSlot") !== null ||
    typeof metadataDocumentId !== "string" ||
    !isPlainObject(onlyGrant) ||
    Reflect.get(onlyGrant, "subjectType") !== "group" ||
    Reflect.get(onlyGrant, "subjectId") !== input.initialAdminGroup.groupId ||
    Reflect.get(onlyGrant, "accessLevel") !== "admin" ||
    Reflect.get(event, "eventType") !== "container.create" ||
    Reflect.get(event, "objectKind") !== "container" ||
    Reflect.get(event, "objectId") !== input.rootContainerId ||
    Reflect.get(event, "organizationId") !== input.organizationId ||
    Reflect.get(event, "signerUserId") !== input.userId ||
    Reflect.get(manifest, "epoch") !== 1 ||
    Reflect.get(manifest, "previousManifestHash") !== null ||
    Reflect.get(manifest, "objectKind") !== "container" ||
    Reflect.get(manifest, "objectId") !== input.rootContainerId ||
    Reflect.get(manifest, "organizationId") !== input.organizationId
  )
    invalid("A replacement must have a fresh private non-system root");
  return metadataDocumentId;
}

/** Commits the exact genesis, independently of the HTTP replacement flags. */
export async function organizationReplacementAuthorizationPayload(
  input: OrganizationReplacementProvisioningInput,
): Promise<AuthorizationPayload> {
  const rootMetadataDocumentId = assertPersonalGenesis(input);
  return {
    replacesOrganizationId: input.replacesOrganizationId,
    organizationId: input.organizationId,
    rootContainerId: input.rootContainerId,
    userId: input.userId,
    organizationStateHash: await computePrincipalStateHash(
      input.initialOrganizationPolicy.state,
    ),
    adminGroupId: input.initialAdminGroup.groupId,
    adminGroupStateHash: await computePrincipalStateHash(
      input.initialAdminGroup.initialGroupPolicy.state,
    ),
    memberGroupId: input.initialMemberGroup.groupId,
    memberGroupStateHash: await computePrincipalStateHash(
      input.initialMemberGroup.initialGroupPolicy.state,
    ),
    rootManifestHash: input.initialRootContainer.expectedManifestHash,
    rootMetadataDocumentId,
  };
}

export function organizationReplacementSigningBytes(
  payload: AuthorizationPayload,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      domain: "tearleads.organization-replacement.v1",
      replacesOrganizationId: payload.replacesOrganizationId,
      organizationId: payload.organizationId,
      rootContainerId: payload.rootContainerId,
      userId: payload.userId,
      organizationStateHash: payload.organizationStateHash,
      adminGroupId: payload.adminGroupId,
      adminGroupStateHash: payload.adminGroupStateHash,
      memberGroupId: payload.memberGroupId,
      memberGroupStateHash: payload.memberGroupStateHash,
      rootManifestHash: payload.rootManifestHash,
      rootMetadataDocumentId: payload.rootMetadataDocumentId,
    }),
  );
}

/** Only locally built personal genesis artifacts may receive this authorization. */
export async function signOrganizationReplacementAuthorization(
  input: OrganizationReplacementProvisioningInput,
  keys: SigningKeyPair,
): Promise<OrganizationReplacementAuthorization> {
  const payload = await organizationReplacementAuthorizationPayload(input);
  return OrganizationReplacementAuthorizationSchema.parse({
    ...payload,
    signature: bytesToBase64(
      sign(
        organizationReplacementSigningBytes(payload),
        keys.signingPrivateKey,
      ),
    ),
  });
}

export function verifyOrganizationReplacementAuthorization(
  value: unknown,
  publicKey: Uint8Array,
): VerifiedOrganizationReplacementAuthorization {
  const parsed = OrganizationReplacementAuthorizationSchema.safeParse(value);
  if (!parsed.success)
    invalid("Organization replacement authorization is missing or malformed");
  const authorization = parsed.data;
  let signature: Uint8Array;
  try {
    signature = base64ToBytes(authorization.signature);
  } catch {
    invalid("Organization replacement signature is malformed");
  }
  if (
    !verify(
      signature,
      organizationReplacementSigningBytes(authorization),
      publicKey,
    )
  ) {
    throw new KeyingVerificationError(
      "signature_mismatch",
      "Organization replacement signature is invalid",
    );
  }
  if (authorization.organizationId === authorization.replacesOrganizationId)
    invalid("Organization replacement does not name a fresh destination");
  return Object.freeze({
    ...authorization,
    [VERIFIED_REPLACEMENT]: true as const,
  });
}
