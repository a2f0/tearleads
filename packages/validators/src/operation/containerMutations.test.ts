import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { organizationProvisioningContainerKeyringRefinement } from "../organizationProvisioningRefinements";
import {
  ContainerCreateWithMetadataDocumentRequestSchema,
  ContainerMutationRequestSchema,
} from "../request";
import {
  CONTAINER_NOT_FOUND_ERROR_CODE,
  ContainerCreateWithMetadataDocumentResponseSchema,
  ContainerDeleteResponseSchema,
  ContainerMutationResponseSchema,
} from "../response";
import {
  ContainerMutationPathParamsSchema,
  createContainerOperation,
  createContainerWithMetadataDocumentOperation,
  deleteContainerOperation,
  isContainerMutationOperationRequest,
  isContainerMutationOperationResponse,
  isCreateContainerWithMetadataDocumentOperationRequest,
  isCreateContainerWithMetadataDocumentOperationResponse,
  isDeleteContainerOperationResponse,
  moveContainerOperation,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
} from "./containerMutations";
import { openApiDocument } from "./openApi";
import {
  createContainerDeleteResponse,
  createContainerMutation,
  createContainerMutationResponse,
  createContainerWithMetadataDocumentRequest,
  createContainerWithMetadataDocumentResponse,
  jsonRoundTrip,
} from "./openApiTestFixtures";

const standardFailureStatuses = [400, 401, 402, 403, 404, 409, 500, 503];
const mutationOperations = [
  createContainerOperation,
  moveContainerOperation,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
] as const;

test("container mutation operations own their complete wire metadata", () => {
  for (const operation of mutationOperations) {
    expect(operation).toMatchObject({
      auth: "session",
      failureStatuses: standardFailureStatuses,
      method: "POST",
      runtimeRefinements: [organizationProvisioningContainerKeyringRefinement],
    });
  }
  expect(createContainerWithMetadataDocumentOperation).toMatchObject({
    auth: "session",
    failureStatuses: standardFailureStatuses,
    method: "POST",
    runtimeRefinements: [organizationProvisioningContainerKeyringRefinement],
  });
  expect(deleteContainerOperation).toMatchObject({
    auth: "session",
    failureStatuses: standardFailureStatuses,
    method: "DELETE",
  });
});

test("container deletion absence has an exact behavior code", () => {
  const schema = deleteContainerOperation.failureResponses[404];
  expect(
    schema.safeParse({
      code: CONTAINER_NOT_FOUND_ERROR_CODE,
      error: "Container not found",
    }).success,
  ).toBe(true);
  expect(schema.safeParse({ error: "Container not found" }).success).toBe(
    false,
  );
});

test("container mutation operation guards derive from canonical schemas", () => {
  const mutationRequest = createContainerMutation();
  const mutationResult =
    ContainerMutationRequestSchema.safeParse(mutationRequest);
  expect(mutationResult.success).toBe(true);
  if (mutationResult.success) {
    expect(mutationResult.data).toBe(mutationRequest);
  }
  expect(isContainerMutationOperationRequest(mutationRequest)).toBe(true);
  expect(
    isContainerMutationOperationResponse(createContainerMutationResponse()),
  ).toBe(true);
  expect(
    isContainerMutationOperationResponse({
      ...createContainerMutationResponse(),
      referencedPrincipalHeads: [
        {
          keyEpoch: 1,
          keyFingerprint: "organization-key-fingerprint",
          principalId: "organization-1",
          principalType: "organization",
          stateHash: "organization-state-hash",
          version: 1,
        },
      ],
    }),
  ).toBe(false);

  const metadataRequest = createContainerWithMetadataDocumentRequest();
  expect(
    ContainerCreateWithMetadataDocumentRequestSchema.safeParse(metadataRequest)
      .success,
  ).toBe(true);
  expect(
    isCreateContainerWithMetadataDocumentOperationRequest(metadataRequest),
  ).toBe(true);
  expect(
    isCreateContainerWithMetadataDocumentOperationResponse(
      createContainerWithMetadataDocumentResponse(),
    ),
  ).toBe(true);
  expect(
    ContainerCreateWithMetadataDocumentResponseSchema.safeParse(
      createContainerWithMetadataDocumentResponse(),
    ).success,
  ).toBe(true);

  const deleteResponse = createContainerDeleteResponse();
  expect(ContainerDeleteResponseSchema.safeParse(deleteResponse).success).toBe(
    true,
  );
  expect(isDeleteContainerOperationResponse(deleteResponse)).toBe(true);
});

test("container mutation path parameters preserve string compatibility", () => {
  expect(
    ContainerMutationPathParamsSchema.safeParse({
      containerId: "legacy-container-id",
    }).success,
  ).toBe(true);
  expect(
    ContainerMutationPathParamsSchema.safeParse({ containerId: 1 }).success,
  ).toBe(false);
});

test("OpenAPI declares the container keyring runtime-only invariant", () => {
  const runtimeRefinements = [
    organizationProvisioningContainerKeyringRefinement,
  ];
  for (const operation of [
    openApiDocument.paths["/containers"]?.post,
    openApiDocument.paths["/containers/{containerId}/move"]?.post,
    openApiDocument.paths["/containers/{containerId}/rekey"]?.post,
    openApiDocument.paths["/containers/{containerId}/revoke"]?.post,
    openApiDocument.paths["/containers/{containerId}/share"]?.post,
    openApiDocument.paths["/containers/with-metadata-document"]?.post,
  ]) {
    expect(operation?.["x-tearleads-runtime-refinements"]).toEqual(
      runtimeRefinements,
    );
  }

  const responseSchema =
    openApiDocument.paths["/containers"]?.post?.responses["200"]?.content?.[
      "application/json"
    ]?.schema;
  if (responseSchema === undefined) {
    throw new Error("Container mutation OpenAPI response is missing");
  }
  const invalidKeyringRelation = jsonRoundTrip({
    ...createContainerMutationResponse(),
    containerKek: {
      ...createContainerMutationResponse().containerKek,
      containerKeyEpoch: 2,
      keyring: null,
    },
  });

  expect(
    new Ajv2020({ strict: true }).compile(responseSchema)(
      invalidKeyringRelation,
    ),
  ).toBe(true);
  expect(
    ContainerMutationResponseSchema.safeParse(invalidKeyringRelation).success,
  ).toBe(false);
});
