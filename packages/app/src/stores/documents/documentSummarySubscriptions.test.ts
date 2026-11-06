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

function directoryHarness() {
  const reads: PromiseWithResolvers<ReadonlyArray<DocumentSummary>>[] = [];
  const errors: unknown[] = [];
  const loads: ReadonlyArray<DocumentSummary>[] = [];
  const persisted: DocumentSummary[] = [];
  let notifyView = () => {};
  let notifyPersisted = (_summary: DocumentSummary) => {};
  let rows = [summary("note")];
  const stop = subscribeToDocumentSummaryDirectory({
    isCurrent: () => true,
    load: () => {
      const read = Promise.withResolvers<ReadonlyArray<DocumentSummary>>();
      reads.push(read);
      return read.promise;
    },
    onError: (error) => errors.push(error),
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
  return {
    discover: (id: string) => {
      rows = [...rows, summary(id)];
      notifyView();
    },
    errors,
    loads,
    persist: (next: DocumentSummary) => notifyPersisted(next),
    persisted,
    reads,
    stop,
  };
}

test("writes during a query discard its answer and coalesce into one more pass", async () => {
  const directory = directoryHarness();
  expect(directory.reads).toHaveLength(1);
  directory.persist(summary("note", "Written"));
  directory.discover("found");
  directory.discover("found-again");
  directory.reads[0]?.resolve([summary("stale")]);
  await Bun.sleep(0);
  expect(directory.loads).toEqual([]);
  expect(directory.reads).toHaveLength(2);
  const fresh = [summary("note", "Written"), summary("found")];
  directory.reads[1]?.resolve(fresh);
  await Bun.sleep(0);
  expect(directory.loads).toEqual([fresh]);
  expect(directory.reads).toHaveLength(2);
  directory.stop();
});

test("a failed query reports only when no write landed since it started", async () => {
  const directory = directoryHarness();
  directory.persist(summary("note", "Written"));
  directory.reads[0]?.reject(new Error("superseded"));
  await Bun.sleep(0);
  expect(directory.errors).toEqual([]);
  expect(directory.reads).toHaveLength(2);
  const failure = new Error("current");
  directory.reads[1]?.reject(failure);
  await Bun.sleep(0);
  expect(directory.errors).toEqual([failure]);
  directory.discover("found");
  expect(directory.reads).toHaveLength(3);
  directory.stop();
});

test("disposal drops the in-flight answer and ignores later events", async () => {
  const directory = directoryHarness();
  directory.persist(summary("note", "Written"));
  directory.stop();
  directory.reads[0]?.resolve([summary("stale")]);
  await Bun.sleep(0);
  directory.persist(summary("late"));
  directory.discover("late");
  expect(directory.loads).toEqual([]);
  expect(directory.reads).toHaveLength(1);
  expect(directory.persisted).toEqual([summary("note", "Written")]);
});
