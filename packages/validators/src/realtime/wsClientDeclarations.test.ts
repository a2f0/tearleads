import { expect, test } from "bun:test";
import {
  MAX_WS_CLIENT_MESSAGE_BYTES,
  parseWsClientDeclaration,
  serializeWsClientDeclaration,
  type WsClientDeclaration,
} from "./wsClientDeclarations";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

test("parses every client declaration tag", () => {
  expect(
    parseWsClientDeclaration(
      JSON.stringify({
        type: "known_containers",
        containerIds: [C1, C2],
        declarationId: "d-1",
      }),
    ),
  ).toEqual({
    containerIds: [C1, C2],
    declarationId: "d-1",
    type: "known_containers",
  });
  expect(
    parseWsClientDeclaration(
      JSON.stringify({ type: "known_containers.add", containerIds: [C1] }),
    ),
  ).toEqual({ containerIds: [C1], type: "known_containers.add" });
  expect(
    parseWsClientDeclaration(
      JSON.stringify({ type: "known_containers.remove", containerIds: [C1] }),
    ),
  ).toEqual({ containerIds: [C1], type: "known_containers.remove" });
  expect(
    parseWsClientDeclaration(
      JSON.stringify({
        type: "known_organizations",
        declarationId: "d-2",
        organizationIds: [ORG],
      }),
    ),
  ).toEqual({
    declarationId: "d-2",
    organizationIds: [ORG],
    type: "known_organizations",
  });
  expect(
    parseWsClientDeclaration(
      JSON.stringify({
        type: "known_organizations",
        declarationId: "d-3",
        organizationIds: [],
      }),
    ),
  ).toEqual({
    declarationId: "d-3",
    organizationIds: [],
    type: "known_organizations",
  });
});

test("omitted container ids stay omitted rather than defaulting", () => {
  expect(
    parseWsClientDeclaration(JSON.stringify({ type: "known_containers" })),
  ).toEqual({ type: "known_containers" });
});

test("round-trips through the shared serializer", () => {
  const declaration: WsClientDeclaration = {
    containerIds: [C1],
    declarationId: "d-1",
    type: "known_containers",
  };
  expect(
    parseWsClientDeclaration(serializeWsClientDeclaration(declaration)),
  ).toEqual(declaration);
});

test("malformed, unknown, and oversized declarations fail closed", () => {
  expect(parseWsClientDeclaration("not json")).toBeNull();
  expect(parseWsClientDeclaration(JSON.stringify(null))).toBeNull();
  expect(parseWsClientDeclaration(JSON.stringify([C1]))).toBeNull();
  expect(parseWsClientDeclaration(JSON.stringify({}))).toBeNull();
  expect(
    parseWsClientDeclaration(JSON.stringify({ type: "unknown_tag" })),
  ).toBeNull();
  expect(
    parseWsClientDeclaration(
      JSON.stringify({ type: "known_containers", containerIds: "nope" }),
    ),
  ).toBeNull();
  expect(
    parseWsClientDeclaration(
      JSON.stringify({ type: "known_containers", containerIds: ["not-uuid"] }),
    ),
  ).toBeNull();
  expect(
    parseWsClientDeclaration(
      JSON.stringify({
        type: "known_containers",
        containerIds: [C1],
        declarationId: "x".repeat(129),
      }),
    ),
  ).toBeNull();
  expect(
    parseWsClientDeclaration(
      JSON.stringify({
        type: "known_containers",
        containerIds: Array.from({ length: 10_001 }, () => C1),
      }),
    ),
  ).toBeNull();
  expect(
    parseWsClientDeclaration(
      JSON.stringify({ type: "known_organizations", organizationIds: [ORG] }),
    ),
  ).toBeNull();
  expect(
    parseWsClientDeclaration(
      JSON.stringify({
        type: "known_organizations",
        declarationId: "d-1",
        organizationIds: [ORG, ORG],
      }),
    ),
  ).toBeNull();
  expect(
    parseWsClientDeclaration(
      `{"type":"known_containers","pad":"${"x".repeat(MAX_WS_CLIENT_MESSAGE_BYTES)}"}`,
    ),
  ).toBeNull();
});
