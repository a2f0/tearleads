import { expect, test } from "bun:test";
import {
  IDLE_PDF_PREVIEW,
  transitionPdfPreview,
  viewPdfPreview,
} from "./fileDocumentPdfPreviewMachine";

type PdfPreviewState = Parameters<typeof transitionPdfPreview>[0];
type PdfPreviewEvent = Parameters<typeof transitionPdfPreview>[1];

const bytes = new Uint8Array([37, 80, 68, 70]) as Uint8Array<ArrayBuffer>;
const LOADING: PdfPreviewState = { run: 1, status: "loading", storageKey: "a" };
const LOADED: PdfPreviewState = {
  bytes,
  openError: null,
  run: 1,
  status: "loaded",
  storageKey: "a",
};
const OPEN_FAILED: PdfPreviewState = { ...LOADED, openError: "open failed" };
const FAILED: PdfPreviewState = {
  message: "read failed",
  run: 1,
  status: "failed",
  storageKey: "a",
};
const STATES = [IDLE_PDF_PREVIEW, LOADING, LOADED, OPEN_FAILED, FAILED];

const CLEARED: PdfPreviewEvent = { type: "cleared" };
const STARTED: PdfPreviewEvent = {
  run: 2,
  storageKey: "b",
  type: "load-started",
};
const BYTES: PdfPreviewEvent = { bytes, run: 1, type: "bytes-loaded" };
const READ_FAILED: PdfPreviewEvent = {
  message: "read failed",
  run: 1,
  type: "load-failed",
};
const OPEN: PdfPreviewEvent = { run: 1, type: "open-started" };
const OPEN_FAIL: PdfPreviewEvent = {
  message: "open failed",
  run: 1,
  type: "open-failed",
};

test("the PDF preview follows the transition table", () => {
  const table: ReadonlyArray<
    readonly [PdfPreviewState, PdfPreviewEvent, PdfPreviewState]
  > = [
    [LOADING, CLEARED, IDLE_PDF_PREVIEW],
    [LOADED, CLEARED, IDLE_PDF_PREVIEW],
    [OPEN_FAILED, CLEARED, IDLE_PDF_PREVIEW],
    [FAILED, CLEARED, IDLE_PDF_PREVIEW],
    [LOADING, BYTES, LOADED],
    [LOADING, READ_FAILED, FAILED],
    [LOADED, OPEN_FAIL, OPEN_FAILED],
    [OPEN_FAILED, OPEN, LOADED],
  ];
  for (const [state, event, expected] of table) {
    expect(transitionPdfPreview(state, event)).toEqual(expected);
  }
  for (const state of STATES) {
    expect(transitionPdfPreview(state, STARTED)).toEqual({
      run: 2,
      status: "loading",
      storageKey: "b",
    });
  }
});

test("the PDF preview ignores events that do not apply", () => {
  const unchanged: ReadonlyArray<readonly [PdfPreviewState, PdfPreviewEvent]> =
    [
      [IDLE_PDF_PREVIEW, CLEARED],
      [IDLE_PDF_PREVIEW, BYTES],
      [IDLE_PDF_PREVIEW, READ_FAILED],
      [IDLE_PDF_PREVIEW, OPEN],
      [IDLE_PDF_PREVIEW, OPEN_FAIL],
      [LOADING, OPEN],
      [LOADING, OPEN_FAIL],
      [LOADED, BYTES],
      [LOADED, READ_FAILED],
      [LOADED, OPEN],
      [OPEN_FAILED, BYTES],
      [OPEN_FAILED, READ_FAILED],
      [OPEN_FAILED, OPEN_FAIL],
      [FAILED, BYTES],
      [FAILED, READ_FAILED],
      [FAILED, OPEN],
      [FAILED, OPEN_FAIL],
    ];
  for (const [state, event] of unchanged) {
    expect(transitionPdfPreview(state, event)).toBe(state);
  }
});

test("only the current run finishes a load or reports an external open", () => {
  const replaced = transitionPdfPreview(LOADING, STARTED);
  expect(transitionPdfPreview(replaced, BYTES)).toBe(replaced);
  expect(transitionPdfPreview(replaced, READ_FAILED)).toBe(replaced);

  const reloaded: PdfPreviewState = { ...LOADED, run: 3 };
  expect(transitionPdfPreview(reloaded, OPEN_FAIL)).toBe(reloaded);
  const reloadedFailure: PdfPreviewState = { ...FAILED, run: 3 };
  expect(transitionPdfPreview(reloadedFailure, OPEN_FAIL)).toBe(
    reloadedFailure,
  );
});

test("the PDF preview view reads only the state of the requested key", () => {
  const nothing = { bytes: null, error: null, loadedRun: null };
  expect(viewPdfPreview(LOADED, undefined)).toEqual({
    ...nothing,
    loading: false,
  });
  expect(viewPdfPreview(IDLE_PDF_PREVIEW, "a")).toEqual({
    ...nothing,
    loading: true,
  });
  expect(viewPdfPreview(LOADED, "b")).toEqual({ ...nothing, loading: true });
  expect(viewPdfPreview(LOADING, "a")).toEqual({ ...nothing, loading: true });
  expect(viewPdfPreview(OPEN_FAILED, "a")).toEqual({
    bytes,
    error: "open failed",
    loadedRun: 1,
    loading: false,
  });
  expect(viewPdfPreview(FAILED, "a")).toEqual({
    ...nothing,
    error: "read failed",
    loading: false,
  });
});
