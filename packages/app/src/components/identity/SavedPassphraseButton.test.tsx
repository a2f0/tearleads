import { afterEach, expect, mock, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/react";
import {
  cleanupIdentityManagerTestEnvironment,
  createIdentityManagerHostConfig,
  IdentityManagerTestRuntime,
} from "../../../test/helpers/identityManagerTestRuntime";
import { SavedPassphraseButton } from "./SavedPassphraseButton";

afterEach(cleanupIdentityManagerTestEnvironment);

function renderButton(pick: () => Promise<string | null>) {
  const onPick = mock((_passphrase: string) => {});
  const hostConfig = createIdentityManagerHostConfig().withOverrides({
    createPasswordKeychain: () => ({ pick, save: async () => "offered" }),
  });
  const surface = (mounted: boolean) => (
    <IdentityManagerTestRuntime
      hostConfig={hostConfig}
      onTearleadsReady={() => {}}
    >
      {mounted && <SavedPassphraseButton disabled={false} onPick={onPick} />}
    </IdentityManagerTestRuntime>
  );
  return { onPick, surface, view: render(surface(true)) };
}

test("a password manager that cannot be read shows an error", async () => {
  const { onPick, view } = renderButton(async () => {
    throw new Error("Credential Manager is unavailable");
  });
  await act(async () => {
    fireEvent.click(
      await view.findByRole("button", { name: "Use Saved Passphrase" }),
    );
  });
  expect(view.getByRole("alert").textContent).toBe(
    "Could not read a saved passphrase from your password manager.",
  );
  expect(onPick).not.toHaveBeenCalled();
});

test("a pick that settles after the form closed fills nothing", async () => {
  const pending = Promise.withResolvers<string | null>();
  const { onPick, surface, view } = renderButton(() => pending.promise);
  fireEvent.click(
    await view.findByRole("button", { name: "Use Saved Passphrase" }),
  );
  view.rerender(surface(false));
  await act(async () => {
    pending.resolve("saved phrase from keychain");
    await pending.promise;
  });
  expect(onPick).not.toHaveBeenCalled();
});
