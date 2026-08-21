import { afterEach, expect, test } from "bun:test";
import type { BlobStore } from "@symcrypt/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import type { ContactEntry } from "../../document-types/contact/contactDocumentModel";
import { ContactsListHome, useContactsSidebarPanel } from "./ContactsSidebar";

const emptyBlobStore: BlobStore = {
  deleteBytes: async () => undefined,
  openByteSource: async () => null,
  readBytes: async () => null,
  writeByteSource: async () => undefined,
  writeBytes: async () => undefined,
};

afterEach(() => {
  cleanup();
});

const entries: ContactEntry[] = [
  {
    id: "ada",
    firstName: "Ada",
    lastName: "Lovelace",
    nickname: "Countess",
    userId: null,
    encapsulationPublicKey: null,
    isSelf: false,
  },
  {
    id: "grace",
    firstName: "Grace",
    lastName: "Hopper",
    nickname: "",
    userId: null,
    encapsulationPublicKey: null,
    isSelf: false,
  },
  {
    id: "imported-user",
    firstName: "",
    lastName: "",
    nickname: "",
    userId: "550e8400-e29b-41d4-a716-446655440000",
    encapsulationPublicKey: "public-key",
    isSelf: false,
  },
  {
    id: "self-nickname",
    firstName: "Local",
    lastName: "Admin",
    nickname: "Boss",
    userId: "self-user-nickname",
    encapsulationPublicKey: "self-public-key",
    isSelf: true,
  },
  {
    id: "self-full-name",
    firstName: "Local",
    lastName: "User",
    nickname: "",
    userId: "self-user-full-name",
    encapsulationPublicKey: "self-public-key",
    isSelf: true,
  },
];

function createContactEntry(id: string): ContactEntry {
  return {
    id,
    firstName: "Contact",
    lastName: id,
    nickname: "",
    userId: null,
    encapsulationPublicKey: null,
    isSelf: false,
  };
}

function ContactsSidebarHarness(
  params: {
    contactEntries?: ContactEntry[] | undefined;
    currentSigningFingerprint?: string | null | undefined;
    currentUserId?: string | null | undefined;
    onAreaContextMenu?: (() => void) | undefined;
    onContactContextMenu?: ((contactId: string) => void) | undefined;
  } = {},
) {
  const [blurred, setBlurred] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const contactEntries = params.contactEntries ?? entries;
  const handleAreaContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      params.onAreaContextMenu?.();
    },
    [params.onAreaContextMenu],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, contactId: string) => {
      event.preventDefault();
      params.onContactContextMenu?.(contactId);
    },
    [params.onContactContextMenu],
  );

  useContactsSidebarPanel({
    blobStore: emptyBlobStore,
    currentSigningFingerprint: params.currentSigningFingerprint,
    currentUserId: params.currentUserId,
    entries: contactEntries,
    handleAreaContextMenu,
    handleContextMenu,
    ready: true,
    selectedContactId,
    setSelectedContactId,
    setSidebar,
  });

  return (
    <>
      <input aria-label="Focused field" onBlur={() => setBlurred(true)} />
      <div>{sidebar}</div>
      <output aria-label="Selected contact">{selectedContactId ?? ""}</output>
      <output aria-label="Focused field blurred">
        {blurred ? "yes" : "no"}
      </output>
    </>
  );
}

test("contacts sidebar selects on primary mouse down after blurring active fields", async () => {
  const view = render(<ContactsSidebarHarness />);
  const focusedField = view.getByLabelText("Focused field");
  focusedField.focus();

  const contactButton = await view.findByRole("button", {
    name: "Grace Hopper",
  });
  fireEvent.mouseDown(contactButton, { button: 0 });

  await waitFor(() => {
    expect(view.getByLabelText("Focused field blurred").textContent).toBe(
      "yes",
    );
    expect(view.getByLabelText("Selected contact").textContent).toBe("grace");
  });
});

test("contacts sidebar shortens user ids when a contact has no name", async () => {
  const view = render(<ContactsSidebarHarness />);

  expect(
    await view.findByRole("button", {
      name: "550e8400",
    }),
  ).toBeTruthy();
});

test("contacts sidebar uses nickname before first and last name", async () => {
  const view = render(<ContactsSidebarHarness />);

  expect(
    await view.findByRole("button", {
      name: "Countess",
    }),
  ).toBeTruthy();
});

test("contacts sidebar does not append self labels to contact names", async () => {
  const view = render(<ContactsSidebarHarness />);

  expect(await view.findByRole("button", { name: "Boss" })).toBeTruthy();
  expect(await view.findByRole("button", { name: "Local User" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Boss (me)" })).toBeNull();
  expect(view.queryByRole("button", { name: "Local User (me)" })).toBeNull();
});

test("contacts sidebar labels only the current self contact as You", async () => {
  const view = render(
    <ContactsSidebarHarness
      currentSigningFingerprint="current-fingerprint"
      contactEntries={[
        {
          id: "self_contact_v1_current-fingerprint",
          firstName: "",
          lastName: "",
          nickname: "",
          userId: "current-user",
          encapsulationPublicKey: "current-public-key",
          isSelf: true,
        },
        {
          id: "self_contact_v1_owner-fingerprint",
          firstName: "",
          lastName: "",
          nickname: "",
          userId: "owner-user",
          encapsulationPublicKey: "owner-public-key",
          isSelf: true,
        },
      ]}
    />,
  );

  expect(await view.findByRole("button", { name: "You" })).toBeTruthy();
  expect(await view.findByRole("button", { name: "owner" })).toBeTruthy();
});

test("contacts list home shows contact metadata and drills into contacts", async () => {
  const selectedContactIds: string[] = [];
  const view = render(
    <ContactsListHome
      blobStore={emptyBlobStore}
      currentSigningFingerprint={null}
      currentUserId={null}
      entries={entries}
      handleAreaContextMenu={(event) => event.preventDefault()}
      handleContextMenu={(event) => event.preventDefault()}
      ready
      selectedContactId={null}
      setSelectedContactId={(contactId) => selectedContactIds.push(contactId)}
    />,
  );

  expect(await view.findByText("Ada Lovelace")).toBeTruthy();
  expect(view.queryByText("Imported key")).toBeNull();
  expect(view.queryByText("Local contact")).toBeNull();

  const contactRowButton = view
    .getAllByRole("button", { name: /Countess/ })
    .find((button) => button.classList.contains("mini-app-row--button"));
  expect(contactRowButton).toBeTruthy();

  fireEvent.click(contactRowButton as HTMLElement);

  expect(selectedContactIds).toEqual(["ada"]);
});

test("contacts sidebar opens the area context menu from blank list space", async () => {
  let areaContextMenuCount = 0;
  const contactContextMenuIds: string[] = [];
  const view = render(
    <ContactsSidebarHarness
      onAreaContextMenu={() => {
        areaContextMenuCount += 1;
      }}
      onContactContextMenu={(contactId) => {
        contactContextMenuIds.push(contactId);
      }}
    />,
  );

  await view.findByRole("button", { name: "Grace Hopper" });
  const list = view.container.querySelector(".mini-app-virtual-list");
  if (!list) {
    throw new Error("Expected contacts virtual list.");
  }

  fireEvent.contextMenu(list);
  fireEvent.contextMenu(view.getByRole("button", { name: "Grace Hopper" }));

  expect(areaContextMenuCount).toBe(1);
  expect(contactContextMenuIds).toEqual(["grace"]);
});

test("contacts sidebar opens the area context menu from virtual spacers", async () => {
  let areaContextMenuCount = 0;
  const view = render(
    <ContactsSidebarHarness
      contactEntries={Array.from({ length: 30 }, (_, index) =>
        createContactEntry(`contact-${index}`),
      )}
      onAreaContextMenu={() => {
        areaContextMenuCount += 1;
      }}
    />,
  );

  await view.findByRole("button", { name: "Contact contact-0" });
  const spacer = view.container.querySelector(".mini-app-virtual-block-spacer");
  if (!spacer) {
    throw new Error("Expected contacts virtual spacer.");
  }

  fireEvent.contextMenu(spacer);

  expect(areaContextMenuCount).toBe(1);
});
