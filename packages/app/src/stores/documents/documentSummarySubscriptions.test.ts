import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import { subscribeToDocumentSummaryDirectory } from "./documentSummarySubscriptions";
import { mergeDocumentSummary } from "./useDocumentSummaries";

function summary(id: string, title = "Syncing document..."): DocumentSummary {
  return {
    id,
    documentId: id,
    containerId: "root",
    documentKind: "note",
    title,
    createdAt: "2026-09-17T12:00:00.000Z",
    updatedAt: "2026-09-17T12:00:00.000Z",
  };
}

test("discovery reloads local rows without replaying old titles or overriding a newer persisted event", async () => {
  const shell = summary("note");
  const hydrated = summary("note", "Decrypted title");
  const first = Promise.withResolvers<ReadonlyArray<DocumentSummary>>();
  const second = Promise.withResolvers<ReadonlyArray<DocumentSummary>>();
  const loads: ReadonlyArray<DocumentSummary>[] = [];
  const persisted: DocumentSummary[] = [];
  let readCount = 0;
  let current = true;
  let notifyView = () => {};
  let notifyPersisted = (_summary: DocumentSummary) => {};
  let rows = [shell];
  const stop = subscribeToDocumentSummaryDirectory({
    isCurrent: () => current,
    load: () => (++readCount === 1 ? first.promise : second.promise),
    onError: (error) => {
      throw error;
    },
    onLoaded: (loaded) => loads.push(loaded),
    onPersisted: (next) => persisted.push(next),
    subscribePersisted: (listener) => {
      notifyPersisted = listener;
      return () => {};
    },
    view: {
      getSnapshot: () => ({
        documentSummariesByContainerId: new Map([["root", rows]]),
      }),
      subscribe: (listener) => {
        notifyView = listener;
        return () => {};
      },
    },
  });
  notifyPersisted(hydrated);
  first.resolve([shell]);
  await first.promise;
  expect(loads).toEqual([]);
  expect(persisted).toEqual([hydrated]);
  expect(readCount).toBe(2);
  second.resolve([hydrated]);
  await second.promise;
  expect(loads).toEqual([[hydrated]]);

  rows = [summary("note", "An older view title")];
  notifyView();
  expect(readCount).toBe(2);
  rows = [...rows, summary("newly-discovered")];
  notifyView();
  expect(readCount).toBe(3);
  current = false;
  await second.promise;
  expect(loads).toEqual([[hydrated]]);
  notifyPersisted(summary("old-domain"));
  expect(persisted).toEqual([hydrated]);
  stop();
});

test("decrypting a shell as another document kind removes it from Notes", () => {
  const shell = summary("profile");
  const note = summary("note", "Keep this note");
  expect(
    mergeDocumentSummary(
      [shell, note],
      {
        ...shell,
        documentKind: "organization_profile",
        title: "Organization name",
      },
      "note",
    ),
  ).toEqual([note]);
});
