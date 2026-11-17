import { base64ToBytes } from "@tearleads/encoding";
import {
  createReadOnlyDocument,
  type HistoryViewer,
  importSnapshot,
  openHistoryViewer,
} from "@tearleads/loro";
import { getDocumentAttachments } from "../../../data/documents/documentContent";
import {
  type DocumentFieldValidationIssue,
  type DocumentProjectorRegistryInput,
  readStoredDocumentState,
} from "../../../data/documents/documentKinds";
import { listDocumentRows } from "../../../data/documents/documentRowList";
import type { DocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { importDocumentHistoryTailUpdates } from "../historyContent";
import {
  compareDocumentHistoryContent,
  type DocumentHistoryChange,
  type DocumentHistoryContent,
} from "./documentHistoryChange";

/** Views kept so stepping to a neighbor does not replay the document twice. */
const VIEW_CACHE_SIZE = 8;

/** One step of a document's history: a single change by a single writer. */
export interface DocumentHistoryStop {
  /** Position in the timeline, oldest first. */
  readonly index: number;
  /** The Loro peer that made the change; resolve it through edit attribution. */
  readonly peerId: string;
  /** Counter of the change's first operation. */
  readonly startCounter: number;
  /** One past the counter of the change's last operation. */
  readonly endCounter: number;
  /**
   * When the writing device recorded the change, in Unix milliseconds, or
   * null when it recorded no time. Self-reported: see `DocumentHistory`.
   */
  readonly committedAt: number | null;
}

/** The document as it was at one stop, in the shape a document store shows. */
export interface DocumentHistoryView extends DocumentHistoryContent {
  readonly fieldValidationIssues: ReadonlyArray<DocumentFieldValidationIssue>;
  readonly title: string;
}

/** The last operation a version includes for one peer. */
export interface DocumentHistoryVersionEntry {
  readonly counter: number;
  readonly peerId: string;
}

/** A version of a document, as the operations that head it. */
export type DocumentHistoryVersion = ReadonlyArray<DocumentHistoryVersionEntry>;

/**
 * A read-only replay of one document's durable local history.
 *
 * It is a capture: it holds the history that was durable when it was opened
 * and never changes afterwards, so the live document keeps editing and
 * syncing untouched. Open another to see later edits. Call `close()` when
 * done; it holds a WASM document.
 *
 * Times are the writing devices' own clocks, and a change is never recorded
 * earlier than the newest time its document already held. History that
 * arrived through a rotation baseline is whatever that baseline's writer
 * asserted.
 */
export interface DocumentHistory {
  /** Every change, in the order the timeline plays them. */
  readonly stops: ReadonlyArray<DocumentHistoryStop>;
  /** What `stops[index]` changed, compared with the stop before it. */
  changeAt(index: number): DocumentHistoryChange;
  close(): void;
  /** The version after `stops[0..index]`. */
  versionAt(index: number): DocumentHistoryVersion;
  /**
   * The document after `stops[0..index]`; `-1` is the empty document before
   * the first change. Replaying a distant stop of a large document can take
   * tens of milliseconds, so keep it out of rendering.
   */
  viewAt(index: number): DocumentHistoryView;
}

class DocumentHistoryReader implements DocumentHistory {
  readonly stops: ReadonlyArray<DocumentHistoryStop>;
  private closed = false;
  /** Insertion-ordered: the first key is the least recently used. */
  private readonly views = new Map<number, DocumentHistoryView>();

  constructor(
    private readonly viewer: HistoryViewer,
    private readonly documentProjectors: DocumentProjectorRegistryInput,
  ) {
    this.stops = viewer.stops.map((stop, index) => ({
      index,
      peerId: stop.peerId,
      startCounter: stop.startCounter,
      endCounter: stop.endCounter,
      committedAt: stop.timestamp === null ? null : stop.timestamp * 1000,
    }));
  }

  changeAt(index: number): DocumentHistoryChange {
    this.assertStop(index, 0);
    return compareDocumentHistoryContent(
      this.viewAt(index - 1),
      this.viewAt(index),
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.views.clear();
    this.viewer.free();
  }

  versionAt(index: number): DocumentHistoryVersion {
    this.assertStop(index, -1);
    return this.viewer.versionAt(index);
  }

  viewAt(index: number): DocumentHistoryView {
    this.assertStop(index, -1);
    const cached = this.views.get(index);
    if (cached !== undefined) {
      this.views.delete(index);
      this.views.set(index, cached);
      return cached;
    }
    this.viewer.checkout(index);
    const { doc } = this.viewer;
    const view: DocumentHistoryView = {
      ...readStoredDocumentState(doc, this.documentProjectors),
      attachments: getDocumentAttachments(doc),
      rows: listDocumentRows(doc),
    };
    this.views.set(index, view);
    if (this.views.size > VIEW_CACHE_SIZE) {
      const oldest = this.views.keys().next();
      if (!oldest.done) this.views.delete(oldest.value);
    }
    return view;
  }

  private assertStop(index: number, lowest: -1 | 0): void {
    if (this.closed) {
      throw new Error("Document history is closed.");
    }
    if (
      !Number.isInteger(index) ||
      index < lowest ||
      index >= this.stops.length
    ) {
      throw new RangeError(`Document history stop ${index} is out of range.`);
    }
  }
}

/**
 * Open a replay of the document's durable local history (checkpoint plus
 * tail). Returns null when the document has none yet, such as a discovered
 * shell that has not hydrated. The history is loaded into a scratch document,
 * never the one a document store is editing.
 */
export async function openDocumentHistory(input: {
  readonly documentProjectors: DocumentProjectorRegistryInput;
  readonly execSql: ExecSql;
  readonly localId: string;
  readonly persistence: Pick<DocumentsPersistence, "loadHistoryRestoreState">;
}): Promise<DocumentHistory | null> {
  const history = await input.persistence.loadHistoryRestoreState(
    input.execSql,
    input.localId,
  );
  if (!history) {
    return null;
  }

  const doc = createReadOnlyDocument();
  try {
    // A tail-only state (a crash before the birth checkpoint landed) has an
    // empty snapshot; the tail rows alone carry the history.
    if (history.snapshot.length > 0) {
      importSnapshot(doc, base64ToBytes(history.snapshot));
    }
    importDocumentHistoryTailUpdates(
      doc,
      history.tailUpdates.map((update) => update.updateData),
    );
    return new DocumentHistoryReader(
      openHistoryViewer(doc),
      input.documentProjectors,
    );
  } catch (error) {
    doc.free();
    throw error;
  }
}
