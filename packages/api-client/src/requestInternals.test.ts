import { expect, test } from "bun:test";
import { describeErrorResponse } from "./requestInternals";

test("describeErrorResponse preserves protocol error codes exactly", async () => {
  const response = Response.json({
    code: " document_sync_state_stale ",
    error: "Stale state",
  });

  expect(await describeErrorResponse(response)).toMatchObject({
    code: " document_sync_state_stale ",
    error: "Stale state",
  });
});

test("describeErrorResponse preserves sync stale-policy repair bundles", async () => {
  const response = Response.json({
    code: "document_sync_state_stale",
    error: "Principal policy is stale",
    principalPolicies: [],
  });

  expect(await describeErrorResponse(response)).toMatchObject({
    code: "document_sync_state_stale",
    stalePrincipalPolicies: [],
  });
});

test("describeErrorResponse ignores policy bundles on terminal sync conflicts", async () => {
  const response = Response.json({
    code: "document_sync_conflict",
    error: "Terminal conflict",
    principalPolicies: [],
  });

  expect(await describeErrorResponse(response)).not.toHaveProperty(
    "stalePrincipalPolicies",
  );
});
