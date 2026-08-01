import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { z } from "zod";
import {
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
  toJsonSchema,
} from "../jsonSchema";
import { DocumentSyncRequestSchema } from "../request";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  DocumentSyncResponseSchema,
} from "../response";
import { documentSyncOperation } from "./documentSync";
import {
  createOpenApiDocument,
  documentSyncOpenApiDocument,
  renderDocumentSyncOpenApi,
} from "./openApi";
import {
  createAccessManifestBundle,
  createContainerMutation,
  createSyncRequest,
  createSyncResponse,
  jsonRoundTrip,
  SYNC_PATH,
} from "./openApiTestFixtures";

const syncPathItem = documentSyncOpenApiDocument.paths[SYNC_PATH];
const syncPost = syncPathItem?.post;
const requestSchema = syncPost?.requestBody.content["application/json"].schema;
const responseSchema =
  syncPost?.responses["200"]?.content?.["application/json"].schema;
const errorResponseSchema =
  syncPost?.responses["409"]?.content?.["application/json"].schema;

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
  expect(documentSyncOpenApiDocument.openapi).toBe("3.1.0");
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
  expect(syncPost.requestBody.required).toBe(true);
  expect(Object.keys(syncPost.responses)).toEqual([
    "200",
    "400",
    "401",
    "402",
    "403",
    "404",
    "409",
    "500",
    "503",
  ]);
  expect(syncPost.responses["400"]?.content).toBeUndefined();
  expect(syncPost.responses["409"]?.description).toBe("Failure JSON response");
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

test("JSON Schema projection rejects unregistered schemas", () => {
  expect(() => toJsonSchema(z.custom(() => true))).toThrow(
    "Missing JSON Schema view for custom at root",
  );
  expect(() => toJsonSchema(z.date())).toThrow(
    "Unsupported JSON wire schema type date at root",
  );
  expect(() => toJsonSchema(z.literal(1n))).toThrow(
    "JSON wire literals must be JSON values at root",
  );
  expect(() => toJsonSchema(z.literal(Number.NaN))).toThrow(
    "JSON wire literals must be JSON values at root",
  );
  expect(() => toJsonSchema(z.literal(Number.POSITIVE_INFINITY))).toThrow(
    "JSON wire literals must be JSON values at root",
  );
  expect(toJsonSchema(z.number())).toEqual({
    maximum: Number.MAX_VALUE,
    minimum: -Number.MAX_VALUE,
    type: "number",
  });
  expect(toJsonSchema(z.number().positive())).toEqual({
    exclusiveMinimum: 0,
    maximum: Number.MAX_VALUE,
    minimum: -Number.MAX_VALUE,
    type: "number",
  });
  expect(() => toJsonSchema(z.number().gt(Number.POSITIVE_INFINITY))).toThrow(
    "Missing direct JSON Schema view for check at root",
  );
  expect(() => toJsonSchema(z.string().refine(() => true))).toThrow(
    "Missing direct JSON Schema view for refinement at root",
  );
  const registeredString = registerJsonSchemaView(z.string(), z.string());
  expect(() => toJsonSchema(registeredString.refine(() => true))).toThrow(
    "Missing direct JSON Schema view for refinement at root",
  );
  expect(() => toJsonSchema(registeredString.min(3))).toThrow(
    "Inherited JSON Schema view must be registered directly at root",
  );
  expect(() =>
    toJsonSchema(
      z
        .object({ value: z.string() })
        .check(z.property("value", z.string().min(3))),
    ),
  ).toThrow("Missing direct JSON Schema view for check at root");
  const conditionalMinimum = z.minLength(3);
  Reflect.set(conditionalMinimum._zod.def, "when", () => false);
  expect(() => toJsonSchema(z.string().check(conditionalMinimum))).toThrow(
    "Missing direct JSON Schema view for check at root",
  );
  expect(() => toJsonSchema(z.string().regex(/abc/i))).toThrow(
    "Missing direct JSON Schema view for check at root",
  );
  expect(() => toJsonSchema(z.jwt({ alg: "HS256" }))).toThrow(
    "Missing JSON Schema view for string at root",
  );
  expect(() =>
    registerJsonSchemaRuntimeRefinements(
      registerJsonSchemaView(z.string(), z.string()),
      [{ id: "phantom.refinement" }],
    ),
  ).toThrow("Runtime refinement metadata requires a custom check");
});

test("JSON Schema projection rejects non-identity wire schemas", () => {
  expect(() => toJsonSchema(z.object({ value: z.coerce.string() }))).toThrow(
    "JSON wire schemas must not coerce values at root.shape.value",
  );
  expect(() => toJsonSchema(z.string().catch("fallback"))).toThrow(
    "JSON wire schemas must not use catch at root",
  );
  expect(() => toJsonSchema(z.string().default("fallback"))).toThrow(
    "JSON wire schemas must not use default at root",
  );
  expect(() => toJsonSchema(z.string().trim())).toThrow(
    "JSON wire schemas must not overwrite values at root",
  );
  expect(() => toJsonSchema(z.url({ normalize: true }))).toThrow(
    "JSON wire schemas must not normalize values at root",
  );
  expect(() => toJsonSchema(z.lazy(() => z.string()))).toThrow(
    "JSON wire schemas must not use lazy at root",
  );
  expect(() => toJsonSchema(z.success(z.string()))).toThrow(
    "JSON wire schemas must not use success at root",
  );
  expect(() =>
    toJsonSchema(z.string().transform((value) => value.length)),
  ).toThrow("JSON wire schemas must not use pipe at root");
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
  const accessManifest = createAccessManifestBundle();
  const completeMutation = {
    ...createContainerMutation(),
    containerManifestHistory: [accessManifest],
    destinationParentContainerPath: [accessManifest],
    parentContainerPath: [accessManifest],
    parentKekState: { epoch: 1 },
    previousContainerPath: [accessManifest],
    previousManifest: accessManifest,
    userRecipientKeys: [{ userId: "user-1" }],
  };
  const validMutations = [
    completeMutation,
    {
      ...completeMutation,
      parentKekState: null,
      previousManifest: null,
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
    "manifest",
    "predecessorBridge",
    "principalPolicies",
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
    { ...createContainerMutation(), principalPolicies: [null] },
    { ...createContainerMutation(), wraps: [null] },
    { ...createContainerMutation(), previousManifest: {} },
    { ...createContainerMutation(), previousContainerPath: [{}] },
    { ...createContainerMutation(), parentContainerPath: [{}] },
    { ...createContainerMutation(), destinationParentContainerPath: [{}] },
    { ...createContainerMutation(), containerManifestHistory: [{}] },
    { ...createContainerMutation(), parentKekState: "invalid" },
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

test("checked-in OpenAPI artifact matches generated bytes", async () => {
  const artifact = new URL("../../../../docs/openapi.json", import.meta.url);
  expect(await Bun.file(artifact).text()).toBe(renderDocumentSyncOpenApi());
});
