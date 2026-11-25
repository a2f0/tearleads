import { afterEach, expect, test } from "bun:test";
import {
  type ContainerDocumentQueries,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ContactMedications } from "./ContactMedications";

afterEach(cleanup);

type WindowRequest = Parameters<
  ContainerDocumentQueries["listContainerDocumentSidebarWindow"]
>[0];

function medicationQueries(
  titles: ReadonlyArray<string>,
  requests: WindowRequest[],
): ContainerDocumentQueries {
  const listContainerDocumentSidebarWindow: ContainerDocumentQueries["listContainerDocumentSidebarWindow"] =
    async (input) => {
      requests.push(input);
      const offset = input.offset ?? 0;
      const limit = input.limit ?? titles.length;
      return {
        totalCount: titles.length,
        rows: titles.slice(offset, offset + limit).map((title, index) => ({
          localId: `medication-${offset + index}`,
          documentId: `remote-medication-${offset + index}`,
          documentKind: "medication",
          containerId: "person",
          title,
          updatedAt: null,
          syncState: syncedContainerDocumentObjectSyncState,
        })),
      };
    };
  // The section reads only this one query.
  return {
    listContainerDocumentSidebarWindow,
  } as unknown as ContainerDocumentQueries;
}

test("a person's medications are listed by title and open the record itself", async () => {
  const requests: WindowRequest[] = [];
  const opened: Array<[string, string]> = [];
  const view = render(
    <ContactMedications
      containerId="person"
      documentQueries={medicationQueries(
        ["Lisinopril 10 mg", "Metformin 500 mg"],
        requests,
      )}
      onOpenDocument={(localId, containerId) =>
        opened.push([localId, containerId])
      }
      revision={0}
    />,
  );

  fireEvent.click(
    await view.findByRole("button", { name: "Metformin 500 mg" }),
  );
  expect(opened).toEqual([["medication-1", "person"]]);
  expect(requests).toEqual([
    { containerId: "person", documentKind: "medication", offset: 0, limit: 10 },
  ]);
  // Two records fit one page, so there is nothing to page through.
  expect(
    view.queryByRole("navigation", { name: "Medication pages" }),
  ).toBeNull();
});

test("a person without medications says so, and a long list pages", async () => {
  const empty = render(
    <ContactMedications
      containerId="person"
      documentQueries={medicationQueries([], [])}
      onOpenDocument={() => undefined}
      revision={0}
    />,
  );
  expect(
    await empty.findByText("No medications in this container."),
  ).toBeTruthy();
  cleanup();

  const titles = Array.from(
    { length: 12 },
    (_, index) => `Medication ${index}`,
  );
  const view = render(
    <ContactMedications
      containerId="person"
      documentQueries={medicationQueries(titles, [])}
      onOpenDocument={() => undefined}
      revision={0}
    />,
  );
  await view.findByRole("button", { name: "Medication 9" });
  expect(view.queryByRole("button", { name: "Medication 10" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Next medications" }));
  await waitFor(() =>
    expect(
      view.queryByRole("button", { name: "Medication 10" }),
    ).not.toBeNull(),
  );
  expect(view.queryByRole("button", { name: "Medication 0" })).toBeNull();
});

test("a page emptied by removed records keeps its way back", async () => {
  const titles = Array.from(
    { length: 12 },
    (_, index) => `Medication ${index}`,
  );
  const props = {
    containerId: "person",
    onOpenDocument: () => undefined,
  };
  const view = render(
    <ContactMedications
      {...props}
      documentQueries={medicationQueries(titles, [])}
      revision={0}
    />,
  );
  fireEvent.click(
    await view.findByRole("button", { name: "Next medications" }),
  );
  await view.findByRole("button", { name: "Medication 10" });

  // Two records go elsewhere; the second page now has nothing on it.
  view.rerender(
    <ContactMedications
      {...props}
      documentQueries={medicationQueries(titles.slice(0, 10), [])}
      revision={1}
    />,
  );
  await waitFor(() =>
    expect(view.queryByRole("button", { name: "Medication 10" })).toBeNull(),
  );
  const previous = view.getByRole("button", { name: "Previous medications" });
  expect(previous.hasAttribute("disabled")).toBe(false);
  fireEvent.click(previous);
  expect(
    await view.findByRole("button", { name: "Medication 0" }),
  ).toBeTruthy();
});
