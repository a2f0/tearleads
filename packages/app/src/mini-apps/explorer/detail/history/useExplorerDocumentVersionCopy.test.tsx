import { afterEach, expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import { cleanup, renderHook } from "@testing-library/react";
import type { SelfContactIdentityView } from "../../../../stores/contacts/currentSelfContactIdentityState";
import type { DocumentVersionCopyContent } from "../../../../stores/document-history/saveDocumentVersionCopy";
import {
  createReadySelfIdentity,
  createSelfIdentityRules,
  identityDocument,
  selfIdentityNodes,
} from "../../model/selfContactIdentity.testUtils";
import { useExplorerDocumentVersionCopy } from "./useExplorerDocumentVersionCopy";

afterEach(cleanup);

type HookParams = Parameters<typeof useExplorerDocumentVersionCopy>[0];
type OpenInput = Parameters<HookParams["appData"]["openDocument"]>[0];

const NOTE: DocumentVersionCopyContent = {
  documentKind: "note",
  rows: [],
  structuredFields: {},
  text: "an earlier version",
};
const CONTACT: DocumentVersionCopyContent = {
  documentKind: "contact",
  rows: [],
  structuredFields: { firstName: "Ada" },
  text: "",
};

/** Document links whose stores open at once, or when the test lets them. */
function documentLinks(options: { held?: boolean } = {}) {
  const opened: OpenInput[] = [];
  const release: Array<() => void> = [];
  const appData: HookParams["appData"] = {
    openDocument: (input) => {
      opened.push(input);
      return {
        ensureInitialized: () =>
          options.held
            ? new Promise<boolean>((resolve) => {
                release.push(() => resolve(true));
              })
            : Promise.resolve(true),
        getSnapshot: () => ({
          documentId: null,
          documentKind: input.initialDocumentKind,
          ready: true,
          title: "from the store",
        }),
        requestSync: () => undefined,
      };
    },
  };
  return { appData, opened, release };
}

function mount(
  identity: SelfContactIdentityView,
  links: ReturnType<typeof documentLinks>,
  nodes: HookParams["nodes"] = selfIdentityNodes,
) {
  const merged: DocumentSummary[] = [];
  const selected: Array<[string, string]> = [];
  const scopes = { current: {} as object };
  const props = (next: {
    identity?: SelfContactIdentityView;
    nodes?: HookParams["nodes"];
  }): HookParams => ({
    appData: links.appData,
    domainScope: scopes.current,
    loadDocumentSummary: async () => null,
    mergeDocumentSummary: (document) => {
      merged.push(document);
    },
    nodes: next.nodes ?? nodes,
    rulesContext: createSelfIdentityRules(next.identity ?? identity),
    selectExplorerDocument: (localId, containerId) => {
      selected.push([localId, containerId]);
    },
  });
  const view = renderHook(useExplorerDocumentVersionCopy, {
    initialProps: props({}),
  });
  return {
    copy: () => view.result.current,
    merged,
    selected,
    update: (
      next: {
        identity?: SelfContactIdentityView;
        newScope?: boolean;
        nodes?: HookParams["nodes"];
      } = {},
    ) => {
      if (next.newScope) scopes.current = {};
      view.rerender(props(next));
    },
  };
}

test("a version is saved into the folder its document is in and listed there", async () => {
  const links = documentLinks();
  const hook = mount(await createReadySelfIdentity(), links);
  const document = identityDocument({ containerId: "linked-folder" });

  expect(hook.copy().canSave(document, "note")).toBe(true);
  const copy = await hook.copy().save(document, NOTE);

  expect(links.opened).toHaveLength(1);
  expect(links.opened[0]).toMatchObject({
    containerId: "linked-folder",
    initialDocumentKind: "note",
    initialText: "an earlier version",
  });
  // A new document, never the original's local id.
  expect(links.opened[0]?.localId).not.toBe(document.id);
  expect(copy?.id).toBe(links.opened[0]?.localId ?? "");
  expect(copy?.containerId).toBe("linked-folder");
  expect(hook.merged).toEqual(copy ? [copy] : []);
});

test("nothing is created where the folder does not take the version", async () => {
  const links = documentLinks();
  const linkedFolder = selfIdentityNodes.find(
    (node) => node.id === "linked-folder",
  );
  if (!linkedFolder) throw new Error("no test folder");
  const hook = mount(await createReadySelfIdentity(), links, [
    ...selfIdentityNodes,
    { ...linkedFolder, id: "trashed-folder", parentId: "trash" },
  ]);

  for (const document of [
    identityDocument({ containerId: "trash" }),
    // An ordinary folder that was moved to the Trash.
    identityDocument({ containerId: "trashed-folder" }),
    identityDocument({ containerId: "not-in-the-tree" }),
    identityDocument({ containerId: null }),
  ]) {
    expect(hook.copy().canSave(document, "note")).toBe(false);
    expect(await hook.copy().save(document, NOTE)).toBeNull();
  }
  expect(links.opened).toHaveLength(0);
  expect(hook.merged).toHaveLength(0);
});

test("the folder is asked again when the copy is confirmed", async () => {
  const links = documentLinks();
  const hook = mount(await createReadySelfIdentity(), links);
  const document = identityDocument({ containerId: "linked-folder" });
  expect(hook.copy().canSave(document, "note")).toBe(true);

  // The folder loses write access after the button was offered.
  hook.update({
    nodes: selfIdentityNodes.map((node) =>
      node.id === "linked-folder"
        ? { ...node, effectiveAccessLevel: "read" as const }
        : node,
    ),
  });

  expect(await hook.copy().save(document, NOTE)).toBeNull();
  expect(links.opened).toHaveLength(0);
});

test("a contact version of Me is never created", async () => {
  const links = documentLinks();
  const identity = await createReadySelfIdentity();
  const hook = mount(identity, links);
  const me = identityDocument({
    containerId: "contacts",
    documentId: identity.identity.documentId,
    documentKind: "contact",
    id: identity.identity.localId,
  });

  expect(hook.copy().canSave(me, "contact")).toBe(false);
  expect(await hook.copy().save(me, CONTACT)).toBeNull();
  expect(links.opened).toHaveLength(0);
});

test("a contact version is created through the Me read's admission", async () => {
  const links = documentLinks();
  let current = true;
  const admitted: string[] = [];
  const ready = await createReadySelfIdentity(() => current);
  const identity: SelfContactIdentityView = {
    ...ready,
    runWhenCurrent: async (work) => {
      admitted.push("asked");
      return current ? work() : null;
    },
  };
  const hook = mount(identity, links);
  const contact = identityDocument({
    containerId: "contacts",
    documentKind: "contact",
  });

  const copy = await hook.copy().save(contact, CONTACT);
  expect(admitted).toEqual(["asked"]);
  expect(copy?.containerId).toBe("contacts");
  expect(links.opened[0]).toMatchObject({
    initialDocumentKind: "contact",
    initialStructuredFields: { firstName: "Ada" },
  });

  // The identity read is superseded: no later contact copy is admitted.
  current = false;
  expect(await hook.copy().save(contact, CONTACT)).toBeNull();
  expect(links.opened).toHaveLength(1);
});

test("a note version does not wait on the Me read", async () => {
  const links = documentLinks();
  const hook = mount({ status: "pending" }, links);
  const document = identityDocument({ containerId: "linked-folder" });

  expect(await hook.copy().save(document, NOTE)).not.toBeNull();
  expect(await hook.copy().save(document, CONTACT)).toBeNull();
  expect(links.opened).toHaveLength(1);
});

test("a copy finished under another database or account is not listed", async () => {
  const links = documentLinks({ held: true });
  const hook = mount(await createReadySelfIdentity(), links);
  const document = identityDocument({ containerId: "linked-folder" });

  const pending = hook.copy().save(document, NOTE);
  hook.update({ newScope: true });
  for (const release of links.release) release();

  // The document exists, so it is still reported to its caller.
  expect(await pending).not.toBeNull();
  expect(hook.merged).toHaveLength(0);
});

test("opening a saved copy selects it in its folder", async () => {
  const hook = mount(await createReadySelfIdentity(), documentLinks());

  hook.copy().open({
    containerId: "linked-folder",
    documentId: null,
    id: "copy-1",
    title: "Copy",
    updatedAt: "2030-01-01T00:00:00.000Z",
  });

  expect(hook.selected).toEqual([["copy-1", "linked-folder"]]);
});
