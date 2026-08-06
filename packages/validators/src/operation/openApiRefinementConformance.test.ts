import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import {
  documentSyncRequestEnvelopeRefinements,
  documentSyncRequestRotationRefinement,
  documentSyncResponseRotationRefinement,
} from "../documentSyncRefinements";
import { DocumentSyncRequestSchema } from "../request";
import { DocumentSyncResponseSchema } from "../response";
import { documentSyncOperation } from "./documentSync";
import { openApiDocument } from "./openApi";
import {
  createSyncRequest,
  createSyncResponse,
  jsonRoundTrip,
  SYNC_PATH,
} from "./openApiTestFixtures";

type RuntimeRefinementId = NonNullable<
  typeof documentSyncOperation.runtimeRefinements
>[number]["id"];

interface RefinementWitness {
  readonly createInput: () => unknown;
  readonly expectedMessage: string;
  readonly kind: "request" | "response";
}

function firstOutgoingUpdate() {
  const update = createSyncRequest().outgoingUpdates[0];
  if (update === undefined) {
    throw new Error("Document sync request fixture needs an outgoing update");
  }
  return update;
}

function firstResponseUpdate() {
  const update = createSyncResponse().updates[0];
  if (update === undefined) {
    throw new Error("Document sync response fixture needs an update");
  }
  return update;
}

const witnesses = {
  [documentSyncRequestRotationRefinement.id]: {
    createInput: () => ({
      ...createSyncRequest(),
      outgoingUpdates: [
        { ...firstOutgoingUpdate(), checkpointKind: "rotate_baseline" },
      ],
    }),
    expectedMessage:
      "checkpoint fields must be absent or form a rotation baseline",
    kind: "request",
  },
  [documentSyncRequestEnvelopeRefinements[0].id]: {
    createInput: () => {
      const request = createSyncRequest();
      Reflect.deleteProperty(request, "authorizingContainerPathRefs");
      return request;
    },
    expectedMessage:
      "authorizing container paths are required for outgoing updates",
    kind: "request",
  },
  [documentSyncRequestEnvelopeRefinements[1].id]: {
    createInput: () => ({ ...createSyncRequest(), outgoingUpdates: [] }),
    expectedMessage: "container rekeys require an outgoing update",
    kind: "request",
  },
  [documentSyncRequestEnvelopeRefinements[2].id]: {
    createInput: () => ({
      ...createSyncRequest(),
      outgoingUpdates: [firstOutgoingUpdate(), firstOutgoingUpdate()],
    }),
    expectedMessage: "outgoing update ids must be unique",
    kind: "request",
  },
  [documentSyncResponseRotationRefinement.id]: {
    createInput: () => ({
      ...createSyncResponse(),
      updates: [
        { ...firstResponseUpdate(), checkpointKind: "rotate_baseline" },
      ],
    }),
    expectedMessage:
      "checkpoint fields must be absent or form a rotation baseline",
    kind: "response",
  },
} satisfies Record<RuntimeRefinementId, RefinementWitness>;

const syncPost = openApiDocument.paths[SYNC_PATH]?.post;
const requestSchema = syncPost?.requestBody.content["application/json"].schema;
const responseSchema =
  syncPost?.responses["200"]?.content?.["application/json"].schema;

if (requestSchema === undefined || responseSchema === undefined) {
  throw new Error("Document sync OpenAPI schemas are missing");
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateRequest = ajv.compile(requestSchema);
const validateResponse = ajv.compile(responseSchema);

test("every declared runtime refinement has an executable witness", () => {
  const declaredIds = (documentSyncOperation.runtimeRefinements ?? [])
    .map((refinement) => refinement.id)
    .sort();
  expect(Object.keys(witnesses).sort()).toEqual(declaredIds);
});

for (const refinement of documentSyncOperation.runtimeRefinements ?? []) {
  test(`${refinement.id} remains an explicit projection gap`, () => {
    const witness = witnesses[refinement.id];
    const input = jsonRoundTrip(witness.createInput());
    const validate =
      witness.kind === "request" ? validateRequest : validateResponse;
    const runtimeSchema =
      witness.kind === "request"
        ? DocumentSyncRequestSchema
        : DocumentSyncResponseSchema;
    const runtimeResult = runtimeSchema.safeParse(input);

    expect(validate(input)).toBe(true);
    expect(runtimeResult.success).toBe(false);
    if (!runtimeResult.success) {
      expect(
        runtimeResult.error.issues.map((issue) => issue.message),
      ).toContain(witness.expectedMessage);
    }
  });
}
