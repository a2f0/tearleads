import { expect, test } from "bun:test";
import { createPayloadAuditor } from "./payloadAudit";
import {
  parsePayloadAudit,
  summarizePayloadAudit,
} from "./payloadAuditSummary";
import { formatPayloadAuditMarkdown } from "./payloadMarkdown";

const bigPayload = (tag: string) => `${tag}_${"a".repeat(80)}`;

test("tracks per-pane echoes, redeliveries, uploaded-then-redownloaded bytes, citations, and exact-head re-reads without leaking secrets", () => {
  const lines: string[] = [];
  const auditor = createPayloadAuditor({ write: (line) => lines.push(line) });
  const uploaded = bigPayload("manifest-bundle");
  const serverOnly = bigPayload("policy-evidence");
  const echoed = bigPayload("signed-event");

  auditor.recordPhase({
    label: "phase-1",
    startIndex: 0,
    requests: [
      {
        authorization: "Bearer secret-token-pane-a",
        knownManifestsCount: 2,
        method: "POST",
        url: "http://localhost:3001/containers",
        routeKey: "POST /containers",
        status: 200,
        requestBody: JSON.stringify({ event: echoed, bundle: uploaded }),
        requestBodyBytes: 220,
        responseBody: JSON.stringify({
          event: echoed,
          policyEvidence: serverOnly,
          policy: {
            principalType: "organization",
            principalId: "org-12345678-aaaa",
            version: 3,
            stateHash: "hash-abcdef1234567890",
          },
        }),
        responseBodyBytes: 380,
      },
      {
        authorization: "Bearer secret-token-pane-a",
        knownManifestsCount: 1,
        method: "GET",
        url: "http://localhost:3001/principals/organization/org-1/policy",
        routeKey: "GET /principals/organization/:organizationId/policy",
        status: 200,
        requestBody: null,
        requestBodyBytes: 0,
        responseBody: JSON.stringify({
          policyEvidence: serverOnly,
          returnedUpload: uploaded,
          policy: {
            principalType: "organization",
            principalId: "org-12345678-aaaa",
            version: 3,
            stateHash: "hash-abcdef1234567890",
          },
        }),
        responseBodyBytes: 340,
      },
      // Second pane receives the same bytes for the first time: NOT a redelivery.
      {
        authorization: "Bearer secret-token-pane-b",
        knownManifestsCount: 0,
        method: "GET",
        url: "http://localhost:3001/principals/organization/org-1/policy",
        routeKey: "GET /principals/organization/:organizationId/policy",
        status: 200,
        requestBody: null,
        requestBodyBytes: 0,
        responseBody: JSON.stringify({
          policyEvidence: serverOnly,
          policy: {
            principalType: "organization",
            principalId: "org-12345678-aaaa",
            version: 3,
            stateHash: "hash-abcdef1234567890",
          },
        }),
        responseBodyBytes: 220,
      },
    ],
  });

  // Re-recording the same indices as an overlapping `test total` phase is ignored.
  auditor.recordPhase({
    label: "test total",
    startIndex: 0,
    requests: [
      {
        authorization: "Bearer secret-token-pane-a",
        knownManifestsCount: 2,
        method: "POST",
        url: "http://localhost:3001/containers",
        routeKey: "POST /containers",
        status: 200,
        requestBody: JSON.stringify({ event: echoed }),
        requestBodyBytes: 120,
        responseBody: JSON.stringify({ event: echoed }),
        responseBodyBytes: 120,
      },
    ],
  });

  // Raw tokens and payload strings must never hit disk.
  const raw = lines.join("");
  expect(raw).not.toContain("secret-token-pane-a");
  expect(raw).not.toContain(uploaded);
  expect(raw).not.toContain(serverOnly);

  const records = parsePayloadAudit(raw);
  expect(records).toHaveLength(3);
  const summary = summarizePayloadAudit(records);
  expect(summary.requests).toBe(3);
  expect(summary.manifestCitations).toBe(3);
  expect(summary.echoBytes).toBe(Buffer.byteLength(echoed, "utf8"));
  expect(summary.redeliveredBytes).toBe(Buffer.byteLength(serverOnly, "utf8"));
  expect(summary.reDownloadedUploadBytes).toBe(
    Buffer.byteLength(uploaded, "utf8"),
  );
  expect(summary.byPane).toHaveLength(2);
  expect(summary.byRoute).toHaveLength(2);

  // Add one more identical GET on pane A to trigger exact-head re-read.
  auditor.recordPhase({
    label: "phase-2",
    startIndex: 3,
    requests: [
      {
        authorization: "Bearer secret-token-pane-a",
        knownManifestsCount: 0,
        method: "GET",
        url: "http://localhost:3001/principals/organization/org-1/policy",
        routeKey: "GET /principals/organization/:organizationId/policy",
        status: 200,
        requestBody: null,
        requestBodyBytes: 0,
        responseBody: JSON.stringify({
          policy: {
            principalType: "organization",
            principalId: "org-12345678-aaaa",
            version: 3,
            stateHash: "hash-abcdef1234567890",
          },
        }),
        responseBodyBytes: 120,
      },
    ],
  });
  const withReread = summarizePayloadAudit(parsePayloadAudit(lines.join("")));
  expect(withReread.exactHeadRereadsCount).toBe(1);
  expect(withReread.exactHeadRereads[0]).toMatchObject({
    route: "GET /principals/organization/:organizationId/policy",
    version: "3",
    extraReads: 1,
  });

  const md = formatPayloadAuditMarkdown("Payload audit", withReread).join("\n");
  expect(md).toContain("### Payload by pane");
  expect(md).toContain("### Payload by route");
  expect(md).toContain("### Exact-head re-reads");
});
