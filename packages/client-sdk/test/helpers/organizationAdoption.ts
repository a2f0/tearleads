import {
  computeAccessManifestHash,
  makeVerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { CreateOrganizationRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { readAccessManifest } from "../../src/data/keyingProjectionVerification/readers";
import { locallyAuthoredAccessManifestHead } from "../../src/data/persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence";
import { persistLocallyAcknowledgedPrincipalPolicyBundle } from "../../src/data/persistence/principalPolicy/locallyAcknowledgedPrincipalPolicyPersistence";
import type { ExecSql } from "../../src/data/sqlite/sqlSchema";
import { createOrganization } from "../../src/workflows/organizations/provisioning/createOrganization";
import {
  principalPolicyBundleFromInitialGroupRequest,
  principalPolicyBundleFromInitialOrganizationRequest,
} from "../../src/workflows/registration/registrationPrincipalPolicyPersistence";
import { execSqlClientFromExecSql } from "./execSqlClient";
import { respondToOrganizationProvisioning } from "./organizationProvisioningResponder";
import { signedPrincipalPolicyBundle } from "./principalPolicyFixtures";
import { createFounder } from "./provisionedPrincipalHistoryFixtures";

/** Local persistence seam: the response is an echo, not a real API commit. */
export async function organizationAdoptionFixture() {
  const { execSql, close } = await createTestExecSql("organization-adoption");
  const founder = await createFounder();
  const requests: CreateOrganizationRequest[] = [];
  const input = {
    identityTrustDomain: "https://api.example.test",
    dbClient: execSqlClientFromExecSql(execSql),
    encapsulationKeyPair: founder.encapsulationKeyPair,
    signingKeyPair: founder.signingKeyPair,
    userId: founder.userId,
    logError: () => {},
    apiClient: {
      createOrganization: async (request: CreateOrganizationRequest) => {
        requests.push(request);
        return requests.length === 1
          ? null
          : respondToOrganizationProvisioning(request);
      },
    },
    provisionedSystemContainers: [
      {
        icon: "trash",
        name: "Trash",
        slotDefinition: {
          namespace: "tearleads.explorer",
          projectorId: "explorer",
          slotId: "trash",
          version: 1,
        },
      },
    ],
  };
  try {
    await createOrganization(input);
    const request = requests[0];
    if (!request) throw new Error("Expected pending organization creation");
    const policies = {
      admin: await principalPolicyBundleFromInitialGroupRequest(
        request.initialAdminGroup,
      ),
      member: await principalPolicyBundleFromInitialGroupRequest(
        request.initialMemberGroup,
      ),
      organization: await principalPolicyBundleFromInitialOrganizationRequest(
        request.initialOrganizationPolicy,
      ),
    };
    return {
      close,
      execSql,
      founder,
      input,
      policies,
      request,
      requests,
      retry: () => createOrganization(input),
      response: await respondToOrganizationProvisioning(request),
    };
  } catch (error) {
    close();
    throw error;
  }
}

export async function acknowledgePolicy(
  execSql: ExecSql,
  organizationId: string,
  bundle: PrincipalPolicyBundleResponse,
) {
  const state = bundle.currentState;
  await persistLocallyAcknowledgedPrincipalPolicyBundle({
    bundle,
    execSql,
    organizationId,
    updatedAt: state.createdAt,
    policy: makeVerifiedPrincipalPolicy({
      ...state,
      state,
      projection: bundle.currentProjection,
      grants: bundle.currentGrants,
      history: [
        ...bundle.previousStates,
        {
          state,
          projection: bundle.currentProjection,
          grants: bundle.currentGrants,
        },
      ],
      checkpoint: {
        principalId: state.principalId,
        principalType: state.principalType,
        stateHash: state.stateHash,
        version: state.version,
      },
    }),
  });
}

/** The same complete head inventory the bootstrap acknowledges. */
export async function adoptionAccessHeads(request: CreateOrganizationRequest) {
  const containers = [
    request.initialRosterProfileContainer,
    request.initialOrganizationMetadataContainer,
    ...(request.initialSystemContainers ?? []),
  ];
  const creates = [
    request.initialRootContainer,
    request.initialRootMetadataDocument,
    request.initialRosterProfileDocument,
    request.initialOrganizationProfileDocument,
    ...containers.flatMap((container) =>
      container ? [container.container, container.metadataDocument] : [],
    ),
  ].filter((create) => create !== undefined);
  return Promise.all(
    creates.map(async (create) => {
      const manifest = readAccessManifest(
        create.manifest,
        "Organization adoption manifest",
      );
      const manifestHash = await computeAccessManifestHash(manifest);
      return locallyAuthoredAccessManifestHead({ manifest, manifestHash });
    }),
  );
}

export function signSuccessorPolicy(
  bundle: PrincipalPolicyBundleResponse,
  signingPrivateKey: Uint8Array,
) {
  return signedPrincipalPolicyBundle({
    memberEnvelopes: bundle.currentMemberEnvelopes.envelopes,
    payloadCiphertext: bundle.currentPayload.ciphertext,
    projection: bundle.currentProjection,
    previousStates: [
      ...bundle.previousStates,
      {
        state: bundle.currentState,
        projection: bundle.currentProjection,
        grants: bundle.currentGrants,
      },
    ],
    signing: {
      ...bundle.currentState,
      grants: bundle.currentGrants,
      prevStateHash: bundle.currentState.stateHash,
      version: bundle.currentState.version + 1,
    },
    signingPrivateKey,
  });
}
