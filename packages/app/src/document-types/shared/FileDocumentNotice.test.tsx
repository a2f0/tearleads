import { afterEach, expect, test } from "bun:test";
import { WindowMenuProvider } from "@tearleads/windowing";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  FILE_DOCUMENT_ATTACHMENT_DIFFERS_NOTICE,
  FILE_DOCUMENT_ATTACHMENT_UNAVAILABLE_NOTICE,
  FileDocumentFields,
  resolveFileDocumentAttachmentNotice,
} from "./FileDocument";

afterEach(cleanup);

function renderFields(attachmentNotice: string | null) {
  return render(
    <WindowMenuProvider>
      <FileDocumentFields
        attachmentNotice={attachmentNotice}
        canWrite
        downloadDisabled={false}
        downloadError={null}
        editDisabled={false}
        fileName="report.png"
        isEditing={false}
        onCommitFileName={() => undefined}
        onDownload={() => undefined}
        onToggleEditing={() => undefined}
        readFields={[{ label: "File Type", value: "image/png" }]}
      />
    </WindowMenuProvider>,
  );
}

test("surfaces a held file that differs from the document's recorded version", () => {
  const silent = renderFields(null);
  expect(
    silent.queryByText(FILE_DOCUMENT_ATTACHMENT_DIFFERS_NOTICE),
  ).toBeNull();
  silent.unmount();
  const flagged = renderFields(FILE_DOCUMENT_ATTACHMENT_DIFFERS_NOTICE);
  expect(
    flagged.getByText(FILE_DOCUMENT_ATTACHMENT_DIFFERS_NOTICE),
  ).toBeTruthy();
});

test("the differs notice follows the latest slot with local bytes", () => {
  const attachments = [{ slotId: "old" }, { slotId: "current" }];
  expect(
    resolveFileDocumentAttachmentNotice({
      attachments,
      attachmentStatusBySlotId: { current: "intent-mismatch" },
      attachmentStorageKeyBySlotId: { current: "held", old: "held-old" },
    }),
  ).toBe(FILE_DOCUMENT_ATTACHMENT_DIFFERS_NOTICE);
  // A mismatch on a superseded slot, or no local bytes at all, is not reported.
  expect(
    resolveFileDocumentAttachmentNotice({
      attachments,
      attachmentStatusBySlotId: { old: "intent-mismatch" },
      attachmentStorageKeyBySlotId: { current: "held", old: "held-old" },
    }),
  ).toBeNull();
  expect(
    resolveFileDocumentAttachmentNotice({
      attachments,
      attachmentStatusBySlotId: { current: "intent-mismatch" },
      attachmentStorageKeyBySlotId: {},
    }),
  ).toBeNull();
});

test("an unavailable held file is reported with a retry", () => {
  expect(
    resolveFileDocumentAttachmentNotice({
      attachments: [{ slotId: "old" }, { slotId: "current" }],
      attachmentStatusBySlotId: { current: "unavailable" },
      attachmentStorageKeyBySlotId: { old: "held-old" },
    }),
  ).toBe(FILE_DOCUMENT_ATTACHMENT_UNAVAILABLE_NOTICE);
  let retries = 0;
  const view = render(
    <WindowMenuProvider>
      <FileDocumentFields
        attachmentNotice={FILE_DOCUMENT_ATTACHMENT_UNAVAILABLE_NOTICE}
        canWrite={false}
        downloadDisabled
        downloadError={null}
        editDisabled
        fileName="report.png"
        isEditing={false}
        onCommitFileName={() => undefined}
        onDownload={() => undefined}
        onRetryDownload={() => {
          retries += 1;
        }}
        onToggleEditing={() => undefined}
        readFields={[]}
      />
    </WindowMenuProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Retry Download" }));
  expect(retries).toBe(1);
});
