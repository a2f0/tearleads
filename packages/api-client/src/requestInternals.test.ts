import { expect, test } from "bun:test";
import {
  createContainerOperation,
  documentSyncOperation,
  webSocketTicketOperation,
} from "@tearleads/validators/operation";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import {
  describeErrorResponse,
  isRefreshableSessionError,
} from "./requestInternals";

test("session refresh requires the exact status and stable code", () => {
  expect(
    isRefreshableSessionError(401, SESSION_ERROR_CODES.refreshRequired),
  ).toBe(true);
  expect(isRefreshableSessionError(401, null)).toBe(false);
  expect(isRefreshableSessionError(401, "unknown_code")).toBe(false);
  expect(
    isRefreshableSessionError(401, ` ${SESSION_ERROR_CODES.refreshRequired} `),
  ).toBe(false);
  expect(
    isRefreshableSessionError(403, SESSION_ERROR_CODES.refreshRequired),
  ).toBe(false);
});

test("describeErrorResponse preserves schema-validated codes exactly", async () => {
  const response = Response.json(
    {
      code: "document_sync_state_stale",
      error: "Stale state",
    },
    { status: 409 },
  );

  expect(
    await describeErrorResponse(response, documentSyncOperation),
  ).toMatchObject({
    code: "document_sync_state_stale",
    error: "Stale state",
  });
});

test("describeErrorResponse rejects malformed declared failure bodies", async () => {
  const responses = [
    new Response("not-json", { status: 401 }),
    Response.json({ code: "unknown_code", error: "Expired" }, { status: 401 }),
  ];

  for (const response of responses) {
    expect(
      await describeErrorResponse(response, webSocketTicketOperation),
    ).toEqual({
      code: null,
      detail: ": Invalid failure response body",
      error: null,
    });
  }
});

test("describeErrorResponse preserves undeclared raw HTTP failures", async () => {
  expect(await describeErrorResponse(new Response("gateway offline"))).toEqual({
    code: null,
    detail: ": gateway offline",
    error: null,
  });
});

test("describeErrorResponse ignores codes retained by generic schemas", async () => {
  const response = Response.json(
    {
      code: SESSION_ERROR_CODES.refreshRequired,
      error: "Generic failure",
    },
    { status: 500 },
  );

  expect(
    await describeErrorResponse(response, createContainerOperation),
  ).toEqual({
    code: null,
    detail: ": Generic failure",
    error: "Generic failure",
  });
});

test("describeErrorResponse cancels bodies at undeclared statuses", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel: () => {
        cancelled = true;
      },
    }),
    { status: 418 },
  );

  await describeErrorResponse(response, webSocketTicketOperation);

  expect(cancelled).toBe(true);
});

test("describeErrorResponse preserves sync stale-policy repair bundles", async () => {
  const response = Response.json(
    {
      code: "document_sync_state_stale",
      error: "Principal policy is stale",
      principalPolicies: [],
    },
    { status: 409 },
  );

  expect(
    await describeErrorResponse(response, documentSyncOperation),
  ).toMatchObject({
    code: "document_sync_state_stale",
    stalePrincipalPolicies: [],
  });
});

test("describeErrorResponse ignores policy bundles on terminal sync conflicts", async () => {
  const response = Response.json(
    {
      code: "document_sync_conflict",
      error: "Terminal conflict",
      principalPolicies: [],
    },
    { status: 409 },
  );

  expect(
    await describeErrorResponse(response, documentSyncOperation),
  ).not.toHaveProperty("stalePrincipalPolicies");
});

test("describeErrorResponse ignores stale-policy bundles at generic statuses", async () => {
  const response = Response.json(
    {
      code: "principal_policy_stale",
      error: "Injected repair metadata",
      principalPolicies: [],
    },
    { status: 400 },
  );

  expect(
    await describeErrorResponse(response, createContainerOperation),
  ).not.toHaveProperty("stalePrincipalPolicies");
});

test("describeErrorResponse preserves validated payment targets", async () => {
  const response = Response.json(
    {
      error: "Sync seat required",
      organizationId: "organization-1",
      reason: "sync_seat_unassigned",
    },
    { status: 402 },
  );

  expect(
    await describeErrorResponse(
      response,
      documentSyncOperation,
      "organization-1",
    ),
  ).toMatchObject({
    error: "Sync seat required",
    paymentRequiredOrganizationId: "organization-1",
  });
});
