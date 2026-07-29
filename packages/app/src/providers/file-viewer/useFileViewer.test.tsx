import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { createAppHostConfig } from "../../host/AppHostConfig";
import type { FileViewer } from "../../host/FileViewer";
import { AppHostConfigProvider } from "../host/AppHostConfigProvider";
import { FileViewerProvider, useFileViewer } from "./FileViewerProvider";

function Harness() {
  const viewer = useFileViewer();
  return <div data-testid="available">{String(viewer !== null)}</div>;
}

test("creates one native viewer for the app runtime", () => {
  let created = 0;
  const viewer: FileViewer = { viewFile: async () => undefined };
  const hostConfig = createAppHostConfig({
    apiBaseUrl: "http://localhost",
    createFileViewer: () => {
      created += 1;
      return viewer;
    },
    wsUrl: "ws://localhost",
  });
  const tree = (
    <AppHostConfigProvider value={hostConfig}>
      <FileViewerProvider>
        <Harness />
      </FileViewerProvider>
    </AppHostConfigProvider>
  );
  const view = render(tree);

  expect(view.getByTestId("available").textContent).toBe("true");
  view.rerender(tree);
  expect(created).toBe(1);
  view.unmount();
});
