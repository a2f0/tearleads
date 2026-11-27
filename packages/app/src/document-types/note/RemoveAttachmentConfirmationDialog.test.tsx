import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";
import { RemoveAttachmentConfirmationDialog } from "./RemoveAttachmentConfirmationDialog";

afterEach(cleanup);

test("remove attachment confirmation focuses cancel, closes on Escape, and restores focus", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();

  try {
    let cancelCount = 0;
    const view = render(
      <RemoveAttachmentConfirmationDialog
        attachment={{
          byteLength: 2048,
          contentSha256: "sha256-receipt",
          mimeType: "image/png",
          name: "receipt.png",
          slotId: "slot-1",
        }}
        onCancel={() => {
          cancelCount += 1;
        }}
        onConfirm={() => undefined}
      />,
    );

    expect(document.activeElement).toBe(
      view.getByRole("button", {
        name: NOTE_DOCUMENT_LABELS.removeAttachmentConfirmCancel,
      }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cancelCount).toBe(1);

    view.unmount();
    expect(document.activeElement).toBe(opener);
  } finally {
    opener.remove();
  }
});
