import { afterEach, expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  createDomainScope,
  type PendingDownloadQueueItem,
} from "@tearleads/client-sdk";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ExplorerDownloadsPanel } from "./ExplorerDownloadsPanel";

afterEach(cleanup);

test("Downloads shows unknown items and failures, then removes hydrated items", async () => {
  let items: ReadonlyArray<PendingDownloadQueueItem> = [
    {
      localId: "local",
      documentId: "remote",
      objectKind: "document",
      title: null,
      reason: "initial",
      lastError: "Unable to fetch content",
    },
  ];
  const documentQueries = {
    listPendingDownloads: async () => items,
  } as unknown as ContainerDocumentQueries;
  const view = render(
    <ExplorerDownloadsPanel
      documentQueries={documentQueries}
      domainScope={createDomainScope()}
      online
      isAuthenticated
    />,
  );
  await waitFor(() =>
    expect(view.getByText("Document awaiting content")).toBeTruthy(),
  );
  expect(view.getByText("Unable to fetch content")).toBeTruthy();
  expect(view.queryByText("Syncing document...")).toBeNull();
  expect(
    view.queryByRole("button", { name: /Document awaiting content/ }),
  ).toBeNull();
  items = [];
  await waitFor(
    () => expect(view.getByText("No pending downloads.")).toBeTruthy(),
    { timeout: 2000 },
  );
  expect(view.queryByText("Document awaiting content")).toBeNull();
});

test("Downloads distinguishes waiting offline from a failed queue read", async () => {
  let fail = false;
  const documentQueries = {
    listPendingDownloads: async () => {
      if (fail) throw new Error("Storage unavailable");
      return [
        {
          localId: "folder",
          documentId: "metadata",
          objectKind: "container",
          title: null,
          reason: "initial",
          lastError: null,
        },
      ];
    },
  } as unknown as ContainerDocumentQueries;
  const view = render(
    <ExplorerDownloadsPanel
      documentQueries={documentQueries}
      domainScope={createDomainScope()}
      online={false}
      isAuthenticated
    />,
  );
  await waitFor(() =>
    expect(view.getByText("Waiting for connection")).toBeTruthy(),
  );
  expect(view.getByText("Folder awaiting metadata")).toBeTruthy();
  expect(
    view.getByRole("button", { name: "Sync now" }).hasAttribute("disabled"),
  ).toBe(true);
  fail = true;
  await waitFor(
    () =>
      expect(view.getByRole("alert").textContent).toBe("Storage unavailable"),
    { timeout: 2000 },
  );
  expect(view.queryByText("No pending downloads.")).toBeNull();
});
