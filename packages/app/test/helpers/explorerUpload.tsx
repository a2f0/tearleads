import { fireEvent, type RenderResult, within } from "@testing-library/react";
import invariant from "invariant";
import { getExplorerContainerItem } from "./paneTestUtils";

export function createTinySvgImageFile(name = "pixel.svg"): File {
  // Minimal 1x1 SVG. The image importer derives width/height by parsing the
  // source text, so no real raster decoding is needed under jsdom.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" /></svg>';
  return new File([svg], name, { type: "image/svg+xml" });
}

/**
 * Drive Explorer's container "Upload" action: right-click the named container,
 * choose Upload, and feed `file` to the hidden file input. Mirrors the real
 * File -> Upload flow so the import runs through document sync and blob upload.
 */
export function uploadExplorerFile(
  view: RenderResult,
  explorerWindow: HTMLElement,
  containerName: string,
  file: File,
): void {
  fireEvent.contextMenu(
    getExplorerContainerItem(explorerWindow, containerName),
    { clientX: 200, clientY: 200 },
  );
  // Scope to the context menu: the Explorer toolbar carries a same-named
  // "Upload" button whenever a container is active.
  const uploadMenu = view.baseElement.querySelector<HTMLElement>(".menu");
  invariant(uploadMenu, "explorer context menu not found");
  fireEvent.click(within(uploadMenu).getByRole("button", { name: "Upload" }));

  const fileInput = explorerWindow.querySelector<HTMLInputElement>(
    "input.explorer-file-input",
  );
  invariant(fileInput, "Expected explorer file input.");
  fireEvent.change(fileInput, { target: { files: [file] } });
}
