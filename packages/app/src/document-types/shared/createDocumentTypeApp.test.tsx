import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  DEFAULT_DOCUMENT_ID,
  type DocumentsProvider as RealDocumentsProvider,
} from "../../stores/documents/DocumentsProvider";
import {
  createDocumentTypeApp,
  createFileDocumentTypeApp,
} from "./createDocumentTypeApp";

let contentProps: Record<string, unknown> | null = null;
let providerProps: Record<string, unknown> | null = null;

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

test("omits undefined optional provider inputs", () => {
  function TestDocument(props: {
    containerId: string | null;
    initialEditing?: boolean | undefined;
    localId: string;
  }) {
    contentProps = props;
    return null;
  }

  const App = createDocumentTypeApp(undefined, TestDocument, TestProvider);
  render(<App />);

  expect(providerProps).toEqual({
    localId: DEFAULT_DOCUMENT_ID,
    readOnly: undefined,
  });
  expect(contentProps).toEqual({
    containerId: null,
    initialEditing: undefined,
    localId: DEFAULT_DOCUMENT_ID,
  });
});

test("file app display names identify their document kind", () => {
  const App = createFileDocumentTypeApp("generic_file", {
    title: "Generic File",
  });

  expect(App.displayName).toBe("GenericFileDocumentApp");
});
