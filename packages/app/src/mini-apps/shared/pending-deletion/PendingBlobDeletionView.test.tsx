import { afterEach, expect, test } from "bun:test";
import type {
  PendingBlobDeletion,
  PendingBlobDeletionsPage,
  RootRequestOutcome,
} from "@tearleads/client-sdk";
import { WindowMenuProvider, WindowToolBar } from "@tearleads/windowing";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { PendingBlobDeletionView } from "./PendingBlobDeletionView";

afterEach(cleanup);

// The view's Refresh is window toolbar chrome, so render it under a toolbar.
function content(props: ComponentProps<typeof PendingBlobDeletionView>) {
  return (
    <WindowMenuProvider>
      <WindowToolBar />
      <PendingBlobDeletionView {...props} />
    </WindowMenuProvider>
  );
}

function blob(blobId: string): PendingBlobDeletion {
  return {
    blobId,
    organizationId: "organization-a",
    byteLength: 4096,
    status: "eligible",
    dereferencedAt: "2026-11-12T10:00:00.000Z",
    eligibleAfter: "2026-11-13T10:00:00.000Z",
    reclaimAttemptedAt: null,
    prunedAt: null,
    objectDeleteAttemptedAt: null,
  };
}

function page(
  blobs: PendingBlobDeletion[],
  nextAfterId: string | null = null,
): RootRequestOutcome<PendingBlobDeletionsPage> {
  return { ok: true, data: { blobs, nextAfterId } };
}

test("pending deletions refresh replaces collected rows and pagination appends the next page", async () => {
  let refreshed = false;
  const request = async (cursor: string | null) => {
    if (refreshed) return page([blob("still-pending")]);
    return cursor === null
      ? page([blob("first-blob")], "next-page")
      : page([blob("second-blob")]);
  };
  const view = render(content({ request }));
  await view.findByText("first-blob");
  fireEvent.click(view.getByRole("button", { name: "Load more" }));
  await view.findByText("second-blob");
  expect(view.getByText("first-blob")).toBeTruthy();
  refreshed = true;
  fireEvent.click(
    await within(view.getByRole("toolbar")).findByRole("button", {
      name: "Refresh",
    }),
  );
  await view.findByText("still-pending");
  expect(view.queryByText("first-blob")).toBeNull();
  expect(view.queryByText("second-blob")).toBeNull();
  expect(view.queryByRole("button", { name: "Load more" })).toBeNull();
});

test("a previous scope's delayed page cannot populate the current pending deletion view", async () => {
  const pending =
    Promise.withResolvers<RootRequestOutcome<PendingBlobDeletionsPage>>();
  const oldRequest = async () => pending.promise;
  const newRequest = async () => page([blob("new-scope-blob")]);
  const view = render(content({ request: oldRequest }));
  await view.findByText("Loading pending deletions...");
  view.rerender(content({ request: newRequest }));
  await view.findByText("new-scope-blob");
  await act(async () => pending.resolve(page([blob("old-scope-blob")])));
  expect(view.queryByText("old-scope-blob")).toBeNull();
  expect(view.getByText("new-scope-blob")).toBeTruthy();
});

test("access refusal clears earlier pages instead of displaying an empty successful queue", async () => {
  let denied = false;
  const request = async () =>
    denied
      ? {
          ok: false as const,
          status: 403,
          message: "Organization admin required",
        }
      : page([blob("private-blob")], "next-page");
  const view = render(content({ request }));
  await view.findByText("private-blob");
  denied = true;
  fireEvent.click(view.getByRole("button", { name: "Load more" }));
  await view.findByText("Organization admin required");
  expect(view.queryByText("private-blob")).toBeNull();
  expect(view.queryByText("No blobs are pending deletion.")).toBeNull();
  denied = false;
  fireEvent.click(
    await within(view.getByRole("toolbar")).findByRole("button", {
      name: "Refresh",
    }),
  );
  await waitFor(() => expect(view.getByText("private-blob")).toBeTruthy());
});
