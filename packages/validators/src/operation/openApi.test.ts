import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { DocumentSyncRequestSchema } from "../request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  DocumentSyncResponseSchema,
} from "../response";
import { documentSyncOperation } from "./documentSync";
import {
  createOpenApiDocument,
  openApiDocument,
  renderOpenApi,
} from "./openApi";
import { httpStatusDescription } from "./openApiPresentation";
import {
  createContainerMutation,
  createSyncRequest,
  createSyncResponse,
  jsonRoundTrip,
  SYNC_PATH,
} from "./openApiTestFixtures";

const syncPathItem = openApiDocument.paths[SYNC_PATH];
const syncPost = syncPathItem?.post;
const requestSchema =
  syncPost?.requestBody?.content["application/json"]?.schema;
const responseSchema =
  syncPost?.responses["200"]?.content?.["application/json"]?.schema;
const errorResponseSchema =
  syncPost?.responses["409"]?.content?.["application/json"]?.schema;

if (syncPost === undefined || requestSchema === undefined) {
  throw new Error("Document sync OpenAPI request is missing");
}
if (responseSchema === undefined) {
  throw new Error("Document sync OpenAPI response is missing");
}
if (errorResponseSchema === undefined) {
  throw new Error("Document sync OpenAPI error response is missing");
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateRequestSchema = ajv.compile(requestSchema);
const validateResponseSchema = ajv.compile(responseSchema);
const validateErrorResponseSchema = ajv.compile(errorResponseSchema);

test("document sync emits its operation registry as OpenAPI 3.1", () => {
  expect(openApiDocument.openapi).toBe("3.1.0");
  expect(syncPost.operationId).toBe("documents.sync");
  expect(syncPost.parameters).toEqual([
    {
      explode: false,
      in: "path",
      name: "documentId",
      required: true,
      schema: { type: "string" },
      style: "simple",
    },
  ]);
  expect(syncPost.security).toEqual([{ bearerAuth: [] }]);
  expect(syncPost.requestBody?.required).toBe(true);
  expect(Object.keys(syncPost.responses).join(",")).toBe(
    "200,400,401,402,403,404,409,413,500,503",
  );
  for (const status of ["400", "402", "403", "409", "500", "503"]) {
    const response = syncPost.responses[status];
    expect(response?.content?.["application/json"]).toBeDefined();
    expect(response?.description).toBe(httpStatusDescription(Number(status)));
  }
  expect(syncPost.responses["413"]?.description).toBe(
    "Serialized document sync requests are limited to 16777216 bytes",
  );
  expect(syncPost["x-tearleads-runtime-refinements"]).toEqual(
    documentSyncOperation.runtimeRefinements,
  );
});

test("document sync OpenAPI declares the stable 409 error envelope", () => {
  expect(
    validateErrorResponseSchema({
      code: DOCUMENT_SYNC_ERROR_CODES.stateStale,
      error: "State changed",
      future: true,
    }),
  ).toBe(true);
  expect(
    validateErrorResponseSchema({ code: "unknown", error: "State changed" }),
  ).toBe(false);
  expect(validateErrorResponseSchema({ error: "State changed" })).toBe(false);
});

test("OpenAPI generation rejects runtime-refinement metadata drift", () => {
  expect(() =>
    createOpenApiDocument([
      { ...documentSyncOperation, runtimeRefinements: [] },
    ]),
  ).toThrow(
    "documents.sync runtime refinement metadata does not match its schemas",
  );
});

test("OpenAPI generation rejects duplicate operation ids", () => {
  expect(() =>
    createOpenApiDocument([
      documentSyncOperation,
      { ...documentSyncOperation, method: "GET" },
    ]),
  ).toThrow("documents.sync operation id is duplicated");
});

test("emitted schemas accept representative JSON wire values", () => {
  const request = jsonRoundTrip(createSyncRequest());
  const response = jsonRoundTrip(createSyncResponse());

  expect(DocumentSyncRequestSchema.safeParse(request).success).toBe(true);
  expect(validateRequestSchema(request)).toBe(true);
  expect(DocumentSyncResponseSchema.safeParse(response).success).toBe(true);
  expect(validateResponseSchema(response)).toBe(true);
});

test("emitted schemas reject the same structural failures as runtime schemas", () => {
  const missingRequestField = createSyncRequest();
  Reflect.deleteProperty(missingRequestField, "expectedTargetHash");
  const malformedContainerRekey = {
    ...createSyncRequest(),
    containerRekeys: [{}],
  };
  const invalidRequests = [
    missingRequestField,
    { ...createSyncRequest(), contentKeyEpoch: 0 },
    { ...createSyncRequest(), contentKeyEpoch: 1e-10 },
    { ...createSyncRequest(), minLsn: "not-an-lsn" },
    malformedContainerRekey,
  ];

  const missingResponseField = createSyncResponse();
  Reflect.deleteProperty(missingResponseField, "documentKekTargets");
  const invalidResponses = [
    missingResponseField,
    {
      ...createSyncResponse(),
      updates: [{ ...createSyncResponse().updates[0], accessEpoch: 0 }],
    },
  ];

  for (const input of invalidRequests.map(jsonRoundTrip)) {
    expect(DocumentSyncRequestSchema.safeParse(input).success).toBe(false);
    expect(validateRequestSchema(input)).toBe(false);
  }
  for (const input of invalidResponses.map(jsonRoundTrip)) {
    expect(DocumentSyncResponseSchema.safeParse(input).success).toBe(false);
    expect(validateResponseSchema(input)).toBe(false);
  }
});

test("emitted integer schemas preserve the runtime numeric range", () => {
  const request = jsonRoundTrip({
    ...createSyncRequest(),
    contentKeyEpoch: Number.MAX_VALUE,
  });

  expect(DocumentSyncRequestSchema.safeParse(request).success).toBe(true);
  expect(validateRequestSchema(request)).toBe(true);

  const contentKeyEpochSchema = Object.entries(
    requestSchema.properties ?? {},
  ).find(([name]) => name === "contentKeyEpoch")?.[1];
  expect(contentKeyEpochSchema).toEqual({
    description: expect.any(String),
    exclusiveMinimum: 0,
    maximum: Number.MAX_VALUE,
    type: "integer",
  });

  const overflow = {
    ...createSyncRequest(),
    contentKeyEpoch: JSON.parse("1e400"),
  };
  expect(DocumentSyncRequestSchema.safeParse(overflow).success).toBe(false);
  expect(validateRequestSchema(overflow)).toBe(false);
});

test("container rekey projection follows every runtime guard field", () => {
  const manifestRef = { containerId: "container-1", manifestHash: "hash" };
  const completeMutation = {
    ...createContainerMutation(),
    containerManifestHistoryRefs: [manifestRef],
    destinationParentContainerPathRefs: [manifestRef],
    parentContainerPathRefs: [manifestRef],
    parentKekState: { epoch: 1 },
    previousContainerPathRefs: [manifestRef],
    previousManifestRef: manifestRef,
    userRecipientKeys: [{ userId: "user-1" }],
  };
  const validMutations = [
    completeMutation,
    {
      ...completeMutation,
      parentContainerPathRefs: [],
      parentKekState: null,
      previousManifestRef: null,
    },
  ];

  for (const mutation of validMutations) {
    const input = jsonRoundTrip({
      ...createSyncRequest(),
      containerRekeys: [mutation],
    });
    expect(DocumentSyncRequestSchema.safeParse(input).success).toBe(true);
    expect(validateRequestSchema(input)).toBe(true);
  }

  const requiredFields = [
    "body",
    "event",
    "expectedManifestHash",
    "keyEpoch",
    "keyring",
    "manifest",
    "predecessorBridge",
    "principalPolicyRefs",
    "wraps",
  ];
  for (const field of requiredFields) {
    const mutation = createContainerMutation();
    Reflect.deleteProperty(mutation, field);
    const input = jsonRoundTrip({
      ...createSyncRequest(),
      containerRekeys: [mutation],
    });
    expect(DocumentSyncRequestSchema.safeParse(input).success).toBe(false);
    expect(validateRequestSchema(input)).toBe(false);
  }

  const invalidMutations = [
    { ...createContainerMutation(), event: [] },
    { ...createContainerMutation(), expectedManifestHash: "" },
    { ...createContainerMutation(), keyEpoch: [] },
    { ...createContainerMutation(), manifest: [] },
    { ...createContainerMutation(), principalPolicyRefs: [null] },
    { ...createContainerMutation(), wraps: [null] },
    { ...createContainerMutation(), previousManifestRef: {} },
    { ...createContainerMutation(), previousContainerPathRefs: [{}] },
    { ...createContainerMutation(), parentContainerPathRefs: [{}] },
    {
      ...createContainerMutation(),
      destinationParentContainerPathRefs: [{}],
    },
    { ...createContainerMutation(), containerManifestHistoryRefs: [{}] },
    { ...createContainerMutation(), parentKekRef: "invalid" },
    {
      ...createContainerMutation(),
      parentKekRef: {
        containerId: "parent",
        containerKeyEpochId: "parent-epoch",
        keyEpochHash: "not-a-hash",
      },
    },
    { ...createContainerMutation(), userRecipientKeys: [null] },
  ];
  for (const mutation of invalidMutations) {
    const input = jsonRoundTrip({
      ...createSyncRequest(),
      containerRekeys: [mutation],
    });
    expect(DocumentSyncRequestSchema.safeParse(input).success).toBe(false);
    expect(validateRequestSchema(input)).toBe(false);
  }
});

test("runtime-only refinements remain explicit outside JSON Schema", () => {
  const request = createSyncRequest();
  const update = request.outgoingUpdates[0];
  const duplicateIds = jsonRoundTrip({
    ...request,
    outgoingUpdates: [update, { ...update }],
  });

  expect(validateRequestSchema(duplicateIds)).toBe(true);
  expect(DocumentSyncRequestSchema.safeParse(duplicateIds).success).toBe(false);
});

test("the generated schema advertises the containerRekeys ceiling", () => {
  const schema = JSON.parse(renderOpenApi()) as Record<string, unknown>;
  // The bound must be visible to clients, not only enforced server-side.
  expect(JSON.stringify(schema)).toContain('"maxItems":16');
});
