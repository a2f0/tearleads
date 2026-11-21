import type {
  DocumentHistoryView,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { fireEvent, type RenderResult, render } from "@testing-library/react";
import { useMemo } from "react";
import { EXPLORER_LABELS } from "../../labels";
import {
  DocumentHistoryCopy,
  useDocumentHistoryCopyControl,
} from "./DocumentHistoryCopy";
import type { ExplorerDocumentVersionCopy } from "./useExplorerDocumentVersionCopy";

export const VIEW: DocumentHistoryView = {
  attachments: [],
  documentKind: "note",
  fieldValidationIssues: [],
  rows: [],
  structuredFields: {},
  text: "an earlier version",
  title: "an earlier version",
};

export const DOCUMENT: DocumentSummary = {
  containerId: "folder-1",
  documentId: "remote-1",
  documentKind: "note",
  id: "local-1",
  title: "the current version",
  updatedAt: "2030-01-01T12:00:00.000Z",
};

export const COPY: DocumentSummary = {
  containerId: "folder-1",
  documentId: null,
  documentKind: "note",
  id: "copy-1",
  title: "an earlier version",
  updatedAt: "2030-01-01T12:00:01.000Z",
};

/** A copy capability whose saves stay pending until the test settles them. */
export function versionCopy() {
  const saves: Array<{
    content: unknown;
    document: DocumentSummary;
    fail: (error: unknown) => void;
    settle: (copy: DocumentSummary | null) => void;
  }> = [];
  const asked: Array<{ document: DocumentSummary; documentKind: string }> = [];
  const opened: DocumentSummary[] = [];
  const state = { offered: true };
  const scope = {};
  const copy: ExplorerDocumentVersionCopy = {
    scope,
    canSave: (document, content) => {
      asked.push({ document, documentKind: content.documentKind });
      return state.offered;
    },
    open: (saved) => {
      opened.push(saved);
    },
    save: (document, content) =>
      new Promise<DocumentSummary | null>((settle, fail) => {
        saves.push({ content, document, fail, settle });
      }),
  };
  return { asked, copy, opened, saves, state };
}

interface Shown {
  /** The database or account changed since the last render. */
  newScope?: boolean;
  /** The selected stop. */
  index?: number;
  /** The selected stop is still replaying: there is no version to copy yet. */
  replaying?: boolean;
  /** History is reloading: the timeline, and the control in it, is gone. */
  timeline?: boolean;
}

/** The control under the state its host holds for it, as in the panel. */
function Host(params: {
  capability: ReturnType<typeof versionCopy>;
  onRequested: () => void;
  scope: object;
  shown: Shown;
}) {
  const { capability, scope, shown } = params;
  // The capability is rebuilt under each scope, as the Explorer rebuilds it.
  const copy = useMemo(
    () => ({ ...capability.copy, scope }),
    [capability.copy, scope],
  );
  const control = useDocumentHistoryCopyControl(copy);
  return shown.timeline === false ? null : (
    <DocumentHistoryCopy
      control={control}
      copy={copy}
      documentSummary={DOCUMENT}
      index={shown.index ?? 2}
      onRequested={params.onRequested}
      versionTime="Jan 1, 2030, 12:00:00 PM"
      view={shown.replaying ? null : VIEW}
    />
  );
}

type MountedCopy = RenderResult & {
  /** Re-render: at another stop, while it replays, or without the timeline. */
  update: (next?: Shown) => void;
};

export function mount(
  capability: ReturnType<typeof versionCopy>,
  options: { onRequested?: () => void } = {},
): MountedCopy {
  let scope = capability.copy.scope;
  const element = (shown: Shown = {}) => {
    if (shown.newScope) scope = {};
    return (
      <Host
        capability={capability}
        onRequested={options.onRequested ?? (() => undefined)}
        scope={scope}
        shown={shown}
      />
    );
  };
  const view = render(element());
  return {
    ...view,
    /** Re-render: at another stop, while it replays, or without the timeline. */
    update: (next: Shown = {}) => view.rerender(element(next)),
  };
}

export function copyButton(view: MountedCopy) {
  return view.getByRole("button", {
    name: EXPLORER_LABELS.documentHistoryCopyAction,
  });
}

export async function confirmCopy(view: MountedCopy) {
  fireEvent.click(copyButton(view));
  fireEvent.click(
    await view.findByRole("button", {
      name: EXPLORER_LABELS.documentHistoryCopyConfirm,
    }),
  );
}
