import { afterEach, beforeEach, expect, test } from "bun:test";
import { createIdentitySeedPhraseFromEntropy } from "@tearleads/crypto";
import { act, fireEvent } from "@testing-library/react";
import {
  createIdentityManagerHostConfig,
  TestWebSocket,
} from "../../../../test/helpers/identityManagerTestRuntime";
import { installPrintFrameStub } from "../../../../test/helpers/printFrameTestKit";
import {
  ACKNOWLEDGEMENT_LABEL,
  cleanupRecoveryKeyTestEnvironment,
  renderRecoveryKeyView,
} from "../../../../test/helpers/recoveryKeyTestKit";
import "../../../../test/helpers/msw/server";
import { MOCK_SERVER_RESET_TIMEOUT_MS } from "../../../../test/helpers/msw/server";
import { RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE } from "../../../components/identity/recovery-key/recoveryKeyDisclosure";

const originalWebSocket = globalThis.WebSocket;
let printFrames: ReturnType<typeof installPrintFrameStub> | undefined;
beforeEach(() => {
  Reflect.set(globalThis, "WebSocket", TestWebSocket);
  printFrames = installPrintFrameStub();
});
afterEach(async () => {
  await cleanupRecoveryKeyTestEnvironment();
  printFrames?.restore();
  printFrames = undefined;
  for (const frame of document.querySelectorAll("iframe")) frame.remove();
  Reflect.set(globalThis, "WebSocket", originalWebSocket);
}, MOCK_SERVER_RESET_TIMEOUT_MS);

test("printing the recovery key requires the acknowledgement phrase", async () => {
  const printed = printFrames?.printed ?? [];
  const { seedPhrase, view } = await renderRecoveryKeyView(0x15);

  fireEvent.click(view.getByRole("button", { name: "Print Recovery Key" }));
  expect(
    view.getByRole("heading", { name: "Print recovery key" }),
  ).toBeTruthy();
  const confirmButton = view.getByRole("button", {
    name: "Print",
  }) as HTMLButtonElement;
  expect(confirmButton.disabled).toBe(true);

  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(printed).toHaveLength(0);

  fireEvent.click(view.getByRole("button", { name: "Print Recovery Key" }));
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
  });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Print" }));
  });

  expect(printed).toHaveLength(1);
  expect(
    Array.from(printed[0]?.querySelectorAll("ol li") ?? [], (word) =>
      word.textContent?.trim(),
    ).join(" "),
  ).toBe(seedPhrase);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.getByText("Recovery key sent to print.")).toBeTruthy();
});

test("revoking the disclosure removes a sheet whose dialog never reported closing", async () => {
  const { view } = await renderRecoveryKeyView(0x17);

  fireEvent.click(view.getByRole("button", { name: "Print Recovery Key" }));
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
  });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Print" }));
  });
  expect(document.querySelectorAll("iframe")).toHaveLength(1);

  fireEvent.click(view.getByRole("tab", { name: "Recovery" }));
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
});

async function printSheet(
  view: Awaited<ReturnType<typeof renderRecoveryKeyView>>["view"],
) {
  fireEvent.click(view.getByRole("button", { name: "Print Recovery Key" }));
  fireEvent.change(view.getByLabelText(ACKNOWLEDGEMENT_LABEL), {
    target: { value: RECOVERY_KEY_ACKNOWLEDGEMENT_PHRASE },
  });
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Print" }));
  });
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
}

test("switching identities removes the previous identity's sheet", async () => {
  const { tearleads, view } = await renderRecoveryKeyView(0x18);
  await printSheet(view);

  await act(async () => {
    await tearleads.identity.importSeedPhrase(
      createIdentitySeedPhraseFromEntropy(new Uint8Array(32).fill(0x19)),
    );
  });
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
});

test("closing Identity Manager removes a pending sheet", async () => {
  const { view } = await renderRecoveryKeyView(0x1a);
  await printSheet(view);

  view.unmount();
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
});

test("a shell that cannot print offers no print control", async () => {
  const { view } = await renderRecoveryKeyView(
    0x16,
    createIdentityManagerHostConfig().withOverrides({ disablePrinting: true }),
  );

  expect(view.queryByRole("button", { name: "Print Recovery Key" })).toBeNull();
  expect(
    view.getByRole("button", { name: "Download Recovery Key" }),
  ).toBeTruthy();
});
