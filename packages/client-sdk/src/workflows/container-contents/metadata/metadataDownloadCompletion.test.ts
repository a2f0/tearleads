import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createDocument, exportAllUpdates } from "@tearleads/loro";
import { createDomainScope } from "../../../data/shared/domainScope";
import { getDomainDownloadHistorySnapshot } from "../../../data/sync/downloadHistory";
import { writeContainerMetadataValue } from "./containerMetadataDocument";
import {
  createContainerRecord,
  createDocumentRecord,
} from "./metadata.testFixtures";
import { noteContainerMetadataDownloadDrained } from "./metadataDownloadCompletion";
import type { ContainerMetadataSyncAttempt } from "./metadataRemoteSync";

type MetadataRecord = ContainerMetadataSyncAttempt["requestRecord"];
type Continuation = ContainerMetadataSyncAttempt["consumedPullContinuation"];

const container = createContainerRecord({
  id: "trips",
  metadataDocumentId: "remote-trips",
  name: "Trips",
  parentId: null,
});

const page2: NonNullable<Continuation> = {
  commitLsn: "0/2",
  commitLsnMode: "tracked",
  cursor: "metadata-page-2",
};

async function storedMetadata(): Promise<string> {
  const doc = await createDocument("metadata-download-history");
  writeContainerMetadataValue(doc, { icon: null, name: "Trips" });
  return bytesToBase64(exportAllUpdates(doc));
}

function record(input: Partial<MetadataRecord> = {}): MetadataRecord {
  return createDocumentRecord({
    documentId: "remote-trips",
    id: container.id,
    ...input,
  });
}

/** Settle one metadata pull and return the folders the history recorded. */
function settle(input: {
  consumed: Continuation;
  pullIncomplete?: boolean;
  request: MetadataRecord;
  stored: MetadataRecord;
}) {
  const domainScope = createDomainScope();
  noteContainerMetadataDownloadDrained({
    container,
    domainScope,
    pullIncomplete: input.pullIncomplete ?? false,
    storedRecord: input.stored,
    syncAttempt: {
      consumedPullContinuation: input.consumed,
      requestRecord: input.request,
    },
  });
  return getDomainDownloadHistorySnapshot(domainScope).completed;
}

test("a never-pulled folder whose pull drains is recorded once", async () => {
  const metadataUpdates = await storedMetadata();
  expect(
    settle({
      consumed: null,
      request: record(),
      stored: record({ metadataUpdates }),
    }),
  ).toEqual([
    {
      documentId: "remote-trips",
      localId: "trips",
      objectKind: "container",
      title: "Trips",
    },
  ]);
});

test("a paged first pull is recorded on its last page, not its first", async () => {
  const metadataUpdates = await storedMetadata();
  expect(
    settle({
      consumed: null,
      request: record(),
      stored: record({ metadataUpdates, pullContinuation: page2 }),
    }),
  ).toEqual([]);
  expect(
    settle({
      consumed: page2,
      request: record({ metadataUpdates, pullContinuation: page2 }),
      stored: record({ metadataUpdates }),
    }).map((item) => item.localId),
  ).toEqual(["trips"]);
});

test("re-syncing a stored folder, as after a rename, is not a download", async () => {
  const metadataUpdates = await storedMetadata();
  const stored = record({ metadataUpdates });
  expect(settle({ consumed: null, request: stored, stored })).toEqual([]);
  // A read that consumed no continuation reports it as either empty value.
  expect(settle({ consumed: undefined, request: stored, stored })).toEqual([]);
});

test("a pull recovering a damaged continuation leaves the queue it was listed in", async () => {
  const metadataUpdates = await storedMetadata();
  expect(
    settle({
      consumed: null,
      request: record({
        metadataUpdates,
        pullContinuationRecoveryRequired: true,
      }),
      stored: record({ metadataUpdates }),
    }).map((item) => item.localId),
  ).toEqual(["trips"]);
});

test("a first pull that deferred part of its page is not yet a download", async () => {
  const metadataUpdates = await storedMetadata();
  // Judging spent its budget: the page stored what it judged, with no
  // continuation, and the next pass pulls the rest again.
  expect(
    settle({
      consumed: null,
      pullIncomplete: true,
      request: record(),
      stored: record({ metadataUpdates }),
    }),
  ).toEqual([]);
});
