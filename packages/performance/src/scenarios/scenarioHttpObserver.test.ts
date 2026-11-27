import { expect, test } from "bun:test";
import {
  parsePayloadAudit,
  summarizePayloadAudit,
} from "../canaries/payloadAuditSummary";
import { parseScenarioHttpCapture, summarizeScenarioHttp } from "./httpCapture";
import { createScenarioHttpObserver } from "./scenarioHttpObserver";

test("records HTTP exchanges, error codes, operations, and truncation", () => {
  const httpLines: string[] = [];
  const payloadLines: string[] = [];
  const observer = createScenarioHttpObserver({
    writeHttp: (line) => httpLines.push(line),
    limit: 3,
    writePayload: (line) => payloadLines.push(line),
    captureStacks: true,
  });
  observer.startTest();
  observer.observeTrace("removeFromGroup");
  observer.observeTrace("POST /containers/c-1/revoke 409 ignored-error-trace");

  // Simulate a dropped request before apiServer sees it, then a delivered one.
  const dropCleanup = observer.enqueueStack(
    "POST",
    "http://127.0.0.1:4000/documents/d-1/sync",
    "dropped-stack",
  );
  dropCleanup();

  const liveCleanup = observer.enqueueStack(
    "POST",
    "http://127.0.0.1:4000/documents/d-1/sync",
    "live-stack",
  );
  observer.observeHttp({
    authorization: "Bearer device-a",
    durationMs: 14.34,
    knownManifestsCount: 2,
    method: "POST",
    requestBody: JSON.stringify({ outgoingUpdates: ["x".repeat(80)] }),
    requestBodyBytes: 120,
    responseBody: JSON.stringify({ code: "document_sync_peer_owned" }),
    responseBodyBytes: 42,
    status: 409,
    url: "http://127.0.0.1:4999/documents/d-1/sync",
  });
  liveCleanup();

  // Third record hits the limit; fourth writes the truncation marker.
  observer.observeTrace("editDocument");
  observer.observeTrace("revoke");

  const http = summarizeScenarioHttp(
    parseScenarioHttpCapture(httpLines.join("")),
  );
  expect(http.requests).toBe(1);
  expect(http.conflicts).toBe(1);
  expect(http.errorCodes).toEqual({ document_sync_peer_owned: 1 });
  expect(http.operations).toEqual({ removeFromGroup: 1, editDocument: 1 });
  expect(http.truncated).toBe(true);

  const payloadRecords = parsePayloadAudit(payloadLines.join(""));
  expect(payloadRecords).toHaveLength(1);
  expect(payloadRecords[0]?.issuerStack).toBe("live-stack");
  const payloadSummary = summarizePayloadAudit(payloadRecords);
  expect(payloadSummary.manifestCitations).toBe(2);
});
