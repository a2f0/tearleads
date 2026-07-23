import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ORG_MANAGER_LABELS } from "../labels";
import { DataUsageView } from "./DataUsageView";

afterEach(() => cleanup());

const EMPTY_USAGE = {
  blobs: { blobCount: 0, byteLength: 0 },
  documents: {
    breakdown: [
      {
        byteLength: 0,
        category: "containerMetadata" as const,
        documentCount: 0,
        updateCount: 0,
      },
      {
        byteLength: 0,
        category: "rosterProfiles" as const,
        documentCount: 0,
        updateCount: 0,
      },
      {
        byteLength: 0,
        category: "organizationMetadata" as const,
        documentCount: 0,
        updateCount: 0,
      },
      {
        byteLength: 0,
        category: "user" as const,
        documentCount: 0,
        updateCount: 0,
      },
    ],
    byteLength: 0,
    documentCount: 0,
    updateCount: 0,
  },
  organizationId: "org-a",
  totalByteLength: 0,
};

test("usage explains the synced-only zero for a local organization", () => {
  const view = render(
    <DataUsageView canSync={false} dataUsage={EMPTY_USAGE} pending={false} />,
  );

  expect(view.getByText(ORG_MANAGER_LABELS.usageDefinition)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.usageSyncOff)).toBeTruthy();
  expect(view.getByText("0 documents, 0 updates")).toBeTruthy();
});

test("usage does not claim sync is off before billing resolves", () => {
  const view = render(
    <DataUsageView canSync={null} dataUsage={EMPTY_USAGE} pending={false} />,
  );

  expect(view.queryByText(ORG_MANAGER_LABELS.usageSyncOff)).toBeNull();
});
