import { afterEach, expect, test } from "bun:test";
import {
  deriveStableDocumentId,
  getRosterProfileDocumentLocalId,
} from "@tearleads/client-sdk";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ContactEntry } from "../../../document-types/contact/contactDocumentModel";
import type { SelfContactIdentityView } from "../../../stores/contacts/currentSelfContactIdentityState";
import { getSelfContactLocalId } from "../../../stores/contacts/selfContact";
import {
  type ContactsContextMenuModel,
  useContactsContextMenu,
} from "./ContactsContextMenu";

afterEach(cleanup);

function IdentityMenuHarness(input: {
  entry: ContactEntry;
  identity: SelfContactIdentityView;
  onModel: (model: ContactsContextMenuModel) => void;
  removeContact: (id: string) => Promise<void>;
  setSelectedContactId: (id: string | null) => void;
}) {
  const params = {
    canWrite: true,
    entries: [input.entry],
    removeContact: input.removeContact,
    selectedContactId: input.entry.id,
    selfContactIdentity: input.identity,
    setSelectedContactId: input.setSelectedContactId,
  };
  const model = useContactsContextMenu(params);
  input.onModel(model);
  return (
    <>
      <button
        type="button"
        onContextMenu={(event) =>
          model.handleSidebarContextMenu(event, input.entry.id)
        }
      >
        Contact
      </button>
      <output aria-label="Can remove">
        {model.canRemoveContextMenuContact ? "yes" : "no"}
      </output>
    </>
  );
}

async function createIdentity() {
  const localId = getSelfContactLocalId("contact-menu-identity");
  return {
    documentId: await deriveStableDocumentId(localId),
    localId,
    localIds: new Set([localId, "recovered-me-alias"]),
  };
}

function contactEntry(id: string, documentId: string): ContactEntry {
  return {
    canWrite: true,
    documentId,
    encapsulationPublicKey: null,
    firstName: "",
    id,
    isSelf: false,
    lastName: "",
    nickname: null,
    userId: "same-user",
  };
}

for (const kind of [
  "canonical",
  "roster",
  "pending",
  "failed",
  "expired",
] as const) {
  test(`contact removal uses canonical identity: ${kind}`, async () => {
    const identity = await createIdentity();
    const ordinaryId = await deriveStableDocumentId(
      getRosterProfileDocumentLocalId({
        organizationId: "contact-menu-organization",
        userId: "same-user",
      }),
    );
    const entry =
      kind === "canonical"
        ? contactEntry("recovered-me-alias", identity.documentId)
        : {
            ...contactEntry(ordinaryId, ordinaryId),
            isSelf: kind === "roster",
          };
    const identityView: SelfContactIdentityView =
      kind === "pending"
        ? { status: "pending" }
        : kind === "failed"
          ? { status: "failed", error: new Error("Identity read refused") }
          : {
              status: "ready",
              identity,
              isCurrent: () => kind !== "expired",
              runWhenCurrent: async (work) =>
                kind !== "expired" ? work() : null,
            };
    const removed: string[] = [];
    let remove: () => Promise<void> = async () => {
      throw new Error("Menu not mounted");
    };
    const view = render(
      <IdentityMenuHarness
        entry={entry}
        identity={identityView}
        onModel={(model) => {
          remove = model.removeContextMenuContact;
        }}
        removeContact={async (id) => {
          removed.push(id);
        }}
        setSelectedContactId={() => undefined}
      />,
    );
    fireEvent.contextMenu(view.getByRole("button", { name: "Contact" }));
    expect(view.getByLabelText("Can remove").textContent).toBe(
      kind === "roster" ? "yes" : "no",
    );
    await act(async () => {
      await remove();
    });
    expect(removed).toEqual(kind === "roster" ? [entry.id] : []);
  });
}

test("a retained contact removal callback refuses expired identity", async () => {
  const identity = await createIdentity();
  const documentId = await deriveStableDocumentId("ordinary-contact-history");
  const entry = contactEntry(documentId, documentId);
  let current = true;
  const removed: string[] = [];
  const selections: Array<string | null> = [];
  let remove: () => Promise<void> = async () => {
    throw new Error("Menu not mounted");
  };
  const view = render(
    <IdentityMenuHarness
      entry={entry}
      identity={{
        status: "ready",
        identity,
        isCurrent: () => current,
        runWhenCurrent: async (work) => (current ? work() : null),
      }}
      onModel={(model) => {
        remove = model.removeContextMenuContact;
      }}
      removeContact={async (id) => {
        removed.push(id);
      }}
      setSelectedContactId={(id) => selections.push(id)}
    />,
  );
  fireEvent.contextMenu(view.getByRole("button", { name: "Contact" }));
  expect(view.getByLabelText("Can remove").textContent).toBe("yes");
  const retainedRemove = remove;
  current = false;
  await act(async () => {
    await retainedRemove();
  });
  expect(removed).toEqual([]);
  expect(selections).toEqual([]);
});
