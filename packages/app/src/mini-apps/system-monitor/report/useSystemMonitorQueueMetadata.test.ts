import { expect, test } from "bun:test";
import type { PendingWriteQueueItem } from "@tearleads/client-sdk";
import { createDomainScope } from "@tearleads/client-sdk";
import { selectSystemMonitorWriteQueue } from "./useSystemMonitorQueueMetadata";

const QUEUED_ITEM = {
  containerId: null,
  createdAt: null,
  localId: "PRIVATE cardiology scan.pdf",
  name: null,
  namespace: null,
  objectKind: "document",
  operations: [],
  organizationId: null,
  remoteId: null,
  status: "pending",
  updatedAt: null,
} satisfies PendingWriteQueueItem;

test("a scope switch hides the prior queue when the replacement read never reports", () => {
  const previousScope = createDomainScope();
  const nextScope = createDomainScope();

  expect(
    selectSystemMonitorWriteQueue({
      dbReady: true,
      domainScope: nextScope,
      observed: {
        domainScope: previousScope,
        report: { available: true, items: [QUEUED_ITEM] },
      },
    }),
  ).toEqual({ available: false, items: [] });
});

test("the queue is exposed only for the exact active scope", () => {
  const domainScope = createDomainScope();
  const report = { available: true, items: [QUEUED_ITEM] } as const;

  expect(
    selectSystemMonitorWriteQueue({
      dbReady: true,
      domainScope,
      observed: { domainScope, report },
    }),
  ).toBe(report);
  expect(
    selectSystemMonitorWriteQueue({
      dbReady: false,
      domainScope,
      observed: { domainScope, report },
    }),
  ).toEqual({ available: false, items: [] });
});
