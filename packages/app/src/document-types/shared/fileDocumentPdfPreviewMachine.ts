/**
 * The automatic PDF preview's load, keyed by the attachment's storage key and
 * tagged with the effect run that started it.
 *
 * - `idle`: no PDF to preview.
 * - `loading`: reading the PDF's local bytes.
 * - `loaded`: bytes ready; `openError` holds a failed "open in another app".
 * - `failed`: the bytes could not be read (missing, oversized, or an error).
 *
 * Replaces separate `loaded` and `failure` records, where a failed external
 * open of one PDF could overwrite the load failure of the PDF that replaced
 * it, leaving that one reported as loading forever.
 */
type PdfPreviewState =
  | { readonly status: "idle" }
  | {
      readonly run: number;
      readonly status: "loading";
      readonly storageKey: string;
    }
  | {
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly openError: string | null;
      readonly run: number;
      readonly status: "loaded";
      readonly storageKey: string;
    }
  | {
      readonly message: string;
      readonly run: number;
      readonly status: "failed";
      readonly storageKey: string;
    };

type PdfPreviewEvent =
  | { readonly type: "cleared" }
  | {
      readonly run: number;
      readonly storageKey: string;
      readonly type: "load-started";
    }
  | {
      readonly bytes: Uint8Array<ArrayBuffer>;
      readonly run: number;
      readonly type: "bytes-loaded";
    }
  | {
      readonly message: string;
      readonly run: number;
      readonly type: "load-failed";
    }
  | { readonly run: number; readonly type: "open-started" }
  | {
      readonly message: string;
      readonly run: number;
      readonly type: "open-failed";
    };

export const IDLE_PDF_PREVIEW: PdfPreviewState = { status: "idle" };

/**
 * Pure transition; returns the same reference for ignored events so React
 * skips the re-render. Only the current run may finish a load or report an
 * external open.
 *
 * | state \ event | cleared | load-started | bytes-loaded (run) | load-failed (run) | open-started (run) | open-failed (run) |
 * | ------------- | ------- | ------------ | ------------------ | ----------------- | ------------------ | ----------------- |
 * | idle          | (same)  | loading      | (same)             | (same)            | (same)             | (same)            |
 * | loading       | idle    | loading      | loaded             | failed            | (same)             | (same)            |
 * | loaded        | idle    | loading      | (same)             | (same)            | openError cleared  | openError set     |
 * | failed        | idle    | loading      | (same)             | (same)            | (same)             | (same)            |
 */
export function transitionPdfPreview(
  state: PdfPreviewState,
  event: PdfPreviewEvent,
): PdfPreviewState {
  switch (event.type) {
    case "cleared":
      return state.status === "idle" ? state : IDLE_PDF_PREVIEW;
    case "load-started":
      return {
        run: event.run,
        status: "loading",
        storageKey: event.storageKey,
      };
    case "bytes-loaded":
      return state.status === "loading" && state.run === event.run
        ? { ...state, bytes: event.bytes, openError: null, status: "loaded" }
        : state;
    case "load-failed":
      return state.status === "loading" && state.run === event.run
        ? { ...state, message: event.message, status: "failed" }
        : state;
    case "open-started":
      return withOpenError(state, event.run, null);
    case "open-failed":
      return withOpenError(state, event.run, event.message);
    default:
      return assertNever(event);
  }
}

function withOpenError(
  state: PdfPreviewState,
  run: number,
  openError: string | null,
): PdfPreviewState {
  if (
    state.status !== "loaded" ||
    state.run !== run ||
    state.openError === openError
  ) {
    return state;
  }
  return { ...state, openError };
}

interface PdfPreviewView {
  readonly bytes: Uint8Array<ArrayBuffer> | null;
  readonly error: string | null;
  readonly loading: boolean;
  /** The run whose bytes are shown, which an external open reports against. */
  readonly loadedRun: number | null;
}

/**
 * What to show for the PDF stored at `storageKey`. Until the load effect has
 * started for a new key, the previous key's state reads as loading.
 */
export function viewPdfPreview(
  state: PdfPreviewState,
  storageKey: string | undefined,
): PdfPreviewView {
  if (!storageKey) {
    return { bytes: null, error: null, loading: false, loadedRun: null };
  }
  if (state.status === "idle" || state.storageKey !== storageKey) {
    return { bytes: null, error: null, loading: true, loadedRun: null };
  }
  switch (state.status) {
    case "loading":
      return { bytes: null, error: null, loading: true, loadedRun: null };
    case "loaded":
      return {
        bytes: state.bytes,
        error: state.openError,
        loading: false,
        loadedRun: state.run,
      };
    case "failed":
      return {
        bytes: null,
        error: state.message,
        loading: false,
        loadedRun: null,
      };
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled PDF preview value: ${JSON.stringify(value)}`);
}
