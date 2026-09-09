import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { DocumentsProvider as RealDocumentsProvider } from "../../stores/documents/DocumentsProvider";
import {
  createDocumentTypeApp,
  createFileDocumentTypeApp,
} from "./createDocumentTypeApp";

type CapturedProps = Record<string, unknown> & { localId?: unknown };
let contentProps: CapturedProps | null = null;
let providerProps: CapturedProps | null = null;

function TestProvider({
  children,
  ...props
}: Parameters<typeof RealDocumentsProvider>[0]) {
  providerProps = { ...props };
  return children;
}

afterEach(() => {
  cleanup();
  contentProps = null;
  providerProps = null;
});

test("new document apps share a unique stable ID between their provider and content", () => {
  function TestDocument(props: {
    containerId: string | null;
    initialEditing?: boolean | undefined;
    localId: string;
  }) {
    contentProps = props;
    return null;
  }

  const App = createDocumentTypeApp(undefined, TestDocument, TestProvider);
  const view = render(<App />);
  const localId = providerProps?.localId;
  expect(localId).toMatch(/^[0-9a-f-]{36}$/u);

  expect(providerProps).toEqual({
    localId,
    readOnly: undefined,
  });
  expect(contentProps).toEqual({
    containerId: null,
    initialEditing: undefined,
    localId,
  });
  view.rerender(<App />);
  expect(providerProps?.localId).toBe(localId);
  render(<App />);
  expect(providerProps?.localId).not.toBe(localId);
  view.rerender(
    <App localId="existing-document" documentId="remote-document" />,
  );
  expect(providerProps?.localId).toBe("existing-document");
  expect(contentProps?.localId).toBe("existing-document");
});

test("file app display names identify their document kind", () => {
  const App = createFileDocumentTypeApp("generic_file", {
    title: "Generic File",
  });

  expect(App.displayName).toBe("GenericFileDocumentApp");
});
