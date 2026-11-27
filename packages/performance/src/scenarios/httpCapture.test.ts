import { expect, test } from "bun:test";
import { parseScenarioHttpCapture, summarizeScenarioHttp } from "./httpCapture";

test("parses and summarizes HTTP requests, 409 conflicts, error codes, and ops", () => {
  const raw = [
    JSON.stringify({ kind: "op", name: "removeFromGroup" }),
    JSON.stringify({
      kind: "http",
      route: "PUT /organizations/:organizationId/groups/:groupId/policy-commit",
      method: "PUT",
      status: 409,
      errorCode: "group_policy_version_conflict",
      requestBytes: 1200,
      responseBytes: 180,
      durationMs: 12.4,
      knownManifestsCount: 2,
    }),
    JSON.stringify({
      kind: "http",
      route: "PUT /organizations/:organizationId/groups/:groupId/policy-commit",
      method: "PUT",
      status: 200,
      requestBytes: 1300,
      responseBytes: 420,
      durationMs: 18.2,
      knownManifestsCount: 3,
    }),
    JSON.stringify({ kind: "op", name: "editDocument" }),
    JSON.stringify({ kind: "op", name: "removeFromGroup" }),
  ].join("\n");

  const summary = summarizeScenarioHttp(parseScenarioHttpCapture(raw));
  expect(summary).toEqual({
    requests: 2,
    requestBytes: 2500,
    responseBytes: 600,
    serverMs: 30.6,
    conflicts: 1,
    clientErrors: 1,
    manifestCitations: 5,
    truncated: false,
    statuses: { "200": 1, "409": 1 },
    errorCodes: { group_policy_version_conflict: 1 },
    operations: { removeFromGroup: 2, editDocument: 1 },
    byRoute: {
      "PUT /organizations/:organizationId/groups/:groupId/policy-commit": {
        count: 2,
        conflicts: 1,
        requestBytes: 2500,
        responseBytes: 600,
        serverMs: 30.6,
      },
    },
  });
});

test("marks truncated captures and rejects malformed lines", () => {
  const summary = summarizeScenarioHttp(
    parseScenarioHttpCapture('{"truncated":10}\n'),
  );
  expect(summary.truncated).toBe(true);
  expect(() => parseScenarioHttpCapture('{"kind":"unknown"}\n')).toThrow(
    /line 1 is invalid/u,
  );
  expect(() =>
    parseScenarioHttpCapture(
      JSON.stringify({
        kind: "http",
        route: "GET /x",
        method: "GET",
        status: 200,
        requestBytes: 0,
        responseBytes: 10,
        durationMs: 1,
      }),
    ),
  ).toThrow(/line 1 is invalid/u);
  expect(() =>
    parseScenarioHttpCapture(
      JSON.stringify({
        kind: "http",
        route: "GET /x",
        method: "GET",
        status: 409,
        errorCode: 123,
        requestBytes: 0,
        responseBytes: 10,
        durationMs: 1,
        knownManifestsCount: 0,
      }),
    ),
  ).toThrow(/line 1 is invalid/u);
});
