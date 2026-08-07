import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { PropsWithChildren } from "react";

const DEFAULT_LOCAL_ID = "default-local-id";
let contentProps: Record<string, unknown> | null = null;
let providerProps: Record<string, unknown> | null = null;

mock.module("../../stores/documents/DocumentsProvider", () => ({
  DEFAULT_DOCUMENT_ID: DEFAULT_LOCAL_ID,
  DocumentsProvider: ({
    children,
    ...props
  }: PropsWithChildren<Record<string, unknown>>) => {
    providerProps = props;
    return children;
  },
  useDocument: () => {
    throw new Error("Not used by the document app factory test.");
  },
  useDocumentReadOnly: () => false,
}));

const { createDocumentTypeApp, createFileDocumentTypeApp } = await import(
  "./createDocumentTypeApp"
);

afterEach(() => {
  cleanup();
  contentProps = null;
  providerProps = null;
});

test("omits undefined optional provider inputs", () => {
  function TestDocument(props: {
    containerId: string | null;
    initialEditing?: boolean | undefined;
    localId: string;
  }) {
    contentProps = props;
    return null;
  }

  const App = createDocumentTypeApp(undefined, TestDocument);
  render(<App />);

  expect(providerProps).toEqual({
    localId: DEFAULT_LOCAL_ID,
    readOnly: undefined,
  });
  expect(contentProps).toEqual({
    containerId: null,
    initialEditing: undefined,
    localId: DEFAULT_LOCAL_ID,
  });
});

test("file app display names identify their document kind", () => {
  const App = createFileDocumentTypeApp("generic_file", {
    title: "Generic File",
  });

  expect(App.displayName).toBe("GenericFileDocumentApp");
});
