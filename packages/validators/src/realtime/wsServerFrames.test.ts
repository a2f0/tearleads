import { expect, test } from "bun:test";
import type { WsServerMessage } from "./wsServerFrames";
import {
  parseWsServerMessage,
  serializeWsServerMessage,
} from "./wsServerFrames";

const C1 = "11111111-1111-4111-8111-111111111111";
const ORG = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";

const controlFrames: WsServerMessage[] = [
  { containerIds: [C1], type: "interest_state" },
  { containerIds: [], type: "interest_state" },
  { declarationId: "d-1", type: "known_containers_ack" },
  {
    authorized: true,
    declarationId: "d-2",
    organizationId: ORG,
    type: "known_organizations_ack",
  },
  {
    authorized: true,
    declarationId: "d-3",
    organizationId: null,
    type: "known_organizations_ack",
  },
  { containerId: C1, type: "resync_required" },
  {
    organizationId: ORG,
    originatedFromSession: false,
    type: "organization_read_model_changed",
  },
  { organizationId: ORG, type: "organization_read_model_access_revoked" },
];

const invalidationHints: WsServerMessage[] = [
  {
    containerIds: [C1],
    documentId: DOC,
    type: "document_update_created",
    updateIds: ["u-1"],
  },
  { containerIds: [C1], documentId: DOC, type: "document_update_created" },
  {
    containerIds: [C1],
    documentId: DOC,
    eventType: "document.link",
    type: "document_mutation_created",
  },
  {
    containerId: C1,
    eventType: "container.create",
    parentId: null,
    type: "container_mutation_created",
    updatedAt: "2026-09-03T00:00:00.000Z",
  },
  {
    containerId: C1,
    eventType: "container.move",
    parentId: C1,
    previousParentId: null,
    type: "container_mutation_created",
    updatedAt: "2026-09-03T00:00:00.000Z",
  },
  { type: "shared_with_you", userId: "user-1" },
  { fingerprint: "fp", type: "user_registered", userId: "user-1" },
];

test("every server frame round-trips through the shared serializer", () => {
  for (const frame of [...controlFrames, ...invalidationHints]) {
    expect(parseWsServerMessage(serializeWsServerMessage(frame))).toEqual(
      frame,
    );
  }
});

test("malformed and unknown server frames fail closed", () => {
  expect(parseWsServerMessage("not json")).toBeNull();
  expect(parseWsServerMessage(JSON.stringify(null))).toBeNull();
  expect(parseWsServerMessage(JSON.stringify({}))).toBeNull();
  expect(parseWsServerMessage(JSON.stringify({ type: "mystery" }))).toBeNull();
  expect(
    parseWsServerMessage(JSON.stringify({ type: "interest_state" })),
  ).toBeNull();
  expect(
    parseWsServerMessage(
      JSON.stringify({ declarationId: "", type: "known_containers_ack" }),
    ),
  ).toBeNull();
  expect(
    parseWsServerMessage(
      JSON.stringify({
        authorized: "yes",
        declarationId: "d-1",
        organizationId: ORG,
        type: "known_organizations_ack",
      }),
    ),
  ).toBeNull();
  expect(
    parseWsServerMessage(
      JSON.stringify({ containerId: "", type: "resync_required" }),
    ),
  ).toBeNull();
  expect(
    parseWsServerMessage(
      JSON.stringify({
        organizationId: "not-a-uuid",
        originatedFromSession: true,
        type: "organization_read_model_changed",
      }),
    ),
  ).toBeNull();
  expect(
    parseWsServerMessage(
      JSON.stringify({
        containerIds: [C1],
        documentId: DOC,
        eventType: "document.rename",
        type: "document_mutation_created",
      }),
    ),
  ).toBeNull();
  expect(
    parseWsServerMessage(
      JSON.stringify({
        containerId: C1,
        eventType: "container.create",
        type: "container_mutation_created",
        updatedAt: "2026-09-03T00:00:00.000Z",
      }),
    ),
  ).toBeNull();
});
