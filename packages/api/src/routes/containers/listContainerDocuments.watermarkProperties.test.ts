import { expect, spyOn, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  accessManifestDocumentLinkProjection,
  containerDocumentSyncTombstones,
  containers,
  documents,
} from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { toFingerprint } from "@tearleads/crypto";
import type { SyncWatermark } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { authenticate } from "../../../test/helpers/authenticate";
import { createCurrentDocumentProjection } from "../../../test/helpers/currentProtocolProjection";
import {
  discoveryTimestamp,
  discoveryTimestampValue,
} from "../../../test/helpers/discoveryTimestamp";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

type DocumentChangeFixture = {
  readonly id: string;
  readonly kind: "document" | "tombstone";
  readonly updatedAt: string;
};

const CHANGES: readonly DocumentChangeFixture[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "document",
    updatedAt: discoveryTimestamp("2026-08-31T12:00:00.000900Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    kind: "tombstone",
    updatedAt: discoveryTimestamp("2026-08-31T12:00:00.000100Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    kind: "document",
    updatedAt: discoveryTimestamp("2026-08-31T12:00:00.000100Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    kind: "tombstone",
    updatedAt: discoveryTimestamp("2026-08-31T12:00:00.000500Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    kind: "tombstone",
    updatedAt: discoveryTimestamp("2026-08-31T12:00:00.001900Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    kind: "document",
    updatedAt: discoveryTimestamp("2026-08-31T12:00:00.001100Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000007",
    kind: "tombstone",
    updatedAt: discoveryTimestamp("2026-08-31T12:00:00.001100Z"),
  },
  {
    id: "00000000-0000-4000-8000-000000000008",
    kind: "document",
    updatedAt: discoveryTimestamp("2026-08-31T12:00:00.001500Z"),
  },
];

type DocumentPage = {
  readonly hasMore: boolean;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly updatedAt: string;
  }>;
  readonly nextWatermark: SyncWatermark | null;
  readonly tombstones: ReadonlyArray<{
    readonly documentId: string;
    readonly updatedAt: string;
  }>;
};

function changeKey(change: {
  readonly id: string;
  readonly updatedAt: string;
}) {
  return `${change.updatedAt}/${change.id}`;
}

function pageChangeKeys(page: DocumentPage): string[] {
  return [
    ...page.items.map((item) => changeKey(item)),
    ...page.tombstones.map((tombstone) =>
      changeKey({ id: tombstone.documentId, updatedAt: tombstone.updatedAt }),
    ),
  ].sort();
}

async function requestPage(input: {
  readonly containerId: string;
  readonly limit: number;
  readonly token: string;
  readonly watermark: SyncWatermark | null;
}): Promise<DocumentPage> {
  const searchParams = new URLSearchParams({ limit: String(input.limit) });
  if (input.watermark) {
    searchParams.set("watermarkId", input.watermark.id);
    searchParams.set("watermarkUpdatedAt", input.watermark.updatedAt);
  }
  const response = await routeApp.request(
    `/containers/${input.containerId}/documents?${searchParams}`,
    { headers: { Authorization: `Bearer ${input.token}` } },
  );

  expect(response.status).toBe(200);
  return response.json() as Promise<DocumentPage>;
}

test("document discovery watermarks exhaust every mixed change exactly once", async () => {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const [root] = await db
    .select({ organizationId: containers.organizationId })
    .from(containers)
    .where(eq(containers.id, owner.rootContainerId))
    .limit(1);
  if (!root) throw new Error("Expected registered root container");

  const createdByFingerprint = await toFingerprint(
    owner.signing.signingPublicKey,
  );
  for (const change of CHANGES.toReversed()) {
    if (change.kind === "tombstone") continue;
    await createCurrentDocumentProjection({
      containerIds: [owner.rootContainerId],
      createdByFingerprint,
      documentId: change.id,
      organizationId: root.organizationId,
    });
    await db
      .update(documents)
      .set({ updatedAt: discoveryTimestampValue(change.updatedAt) })
      .where(eq(documents.id, change.id));
  }
  await db.insert(containerDocumentSyncTombstones).values(
    CHANGES.toReversed()
      .filter((change) => change.kind === "tombstone")
      .map((change) => ({
        containerId: owner.rootContainerId,
        documentId: change.id,
        updatedAt: discoveryTimestampValue(change.updatedAt),
      })),
  );

  // The first page contains only a tombstone. Its live lookahead must not
  // expand linked-container paths that will not be returned to this caller.
  const selects = spyOn(db, "select");
  try {
    const first = await requestPage({
      containerId: owner.rootContainerId,
      limit: 1,
      token: owner.token,
      watermark: {
        id: "00000000-0000-4000-8000-000000000001",
        updatedAt: discoveryTimestamp("2026-08-31T12:00:00.000100Z"),
      },
    });
    expect(first.items).toHaveLength(0);
    expect(first.hasMore).toBe(true);
    expect(first.tombstones).toHaveLength(1);
    expect(
      selects.mock.calls.filter(
        ([fields]) =>
          fields &&
          Object.values(fields).includes(
            accessManifestDocumentLinkProjection.containerId,
          ) &&
          Object.values(fields).includes(
            accessManifestDocumentLinkProjection.manifestHash,
          ),
      ),
    ).toHaveLength(0);
  } finally {
    selects.mockRestore();
  }

  const expectedChanges = CHANGES.toSorted((left, right) =>
    changeKey(left).localeCompare(changeKey(right)),
  );
  const expectedKeys = expectedChanges.map((change) => changeKey(change));
  for (let limit = 1; limit <= CHANGES.length; limit += 1) {
    const receivedKeys: string[] = [];
    let watermark: SyncWatermark | null = null;

    for (let pageIndex = 0; pageIndex <= CHANGES.length; pageIndex += 1) {
      const page = await requestPage({
        containerId: owner.rootContainerId,
        limit,
        token: owner.token,
        watermark,
      });
      const pageKeys = pageChangeKeys(page);
      const nextOffset = receivedKeys.length + pageKeys.length;

      expect(pageKeys).toEqual(
        expectedKeys.slice(receivedKeys.length, nextOffset),
      );
      expect(page.hasMore).toBe(nextOffset < expectedKeys.length);
      const expectedLastChange = expectedChanges[nextOffset - 1];
      expect(page.nextWatermark).toEqual(
        expectedLastChange
          ? {
              id: expectedLastChange.id,
              updatedAt: expectedLastChange.updatedAt,
            }
          : watermark,
      );
      receivedKeys.push(...pageKeys);
      if (!page.hasMore) break;
      if (!page.nextWatermark) throw new Error("Expected advancing watermark");
      watermark = page.nextWatermark;
    }

    expect(receivedKeys).toEqual(expectedKeys);
    expect(new Set(receivedKeys).size).toBe(expectedKeys.length);
  }
});
