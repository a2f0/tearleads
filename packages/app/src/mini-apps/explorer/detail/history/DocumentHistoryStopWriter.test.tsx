import { afterEach, expect, test } from "bun:test";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import { cleanup, render } from "@testing-library/react";
import { DocumentHistoryStopWriter } from "./DocumentHistoryStopWriter";

type Segments = DocumentEditAttributionResponse["segments"];

afterEach(cleanup);

const STOP = {
  committedAt: 1_000,
  endCounter: 6,
  index: 3,
  peerId: "7",
  startCounter: 2,
};
const ADA: Segments = [
  {
    authorityKind: "direct",
    endCounter: 10,
    peerId: "7",
    startCounter: 0,
    writerKeyFingerprint: "0123456789abcdef0123456789abcdef",
    writerUserId: "ada",
  },
];

function mount(
  segments: Segments,
  resolveUserLabel?: (userId: string | null | undefined) => string | null,
) {
  return render(
    <DocumentHistoryStopWriter
      resolveUserLabel={resolveUserLabel}
      segments={segments}
      stop={STOP}
    />,
  );
}

test("a change names the person whose upload delivered it", () => {
  const view = mount(ADA, (userId) =>
    userId === "ada" ? "Ada Lovelace" : null,
  );

  const label = view.getByText("Uploaded by Ada Lovelace");
  // The full signing identity is one hover away.
  expect(label.getAttribute("title")).toBe(
    "Ada Lovelace · ada · 0123456789abcdef0123456789abcdef",
  );
});

test("an uploader with no known name is shown by key id", () => {
  const view = mount(ADA);

  expect(view.container.textContent).toMatch(/^Uploaded by \S+$/u);
  expect(view.container.textContent).not.toContain("ada");
});

test("a change with no known uploader shows nothing", () => {
  // Offline, unsynced, or attribution unavailable: no segments at all.
  expect(mount([]).container.textContent).toBe("");
  cleanup();
  // Delivered by a rotation baseline: a re-assertion, not authorship.
  expect(
    mount([{ ...ADA[0], authorityKind: "baseline" } as Segments[number]])
      .container.textContent,
  ).toBe("");
});
