import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  IdentityActionToolbar,
  IdentityDestroyKeyPair,
} from "./IdentityManagerActionToolbar";

afterEach(cleanup);

test("the routine toolbar leaves destroying the key pair out", () => {
  const view = render(
    <IdentityActionToolbar
      canAuthenticate={false}
      canGenerateKey={false}
      canRegisterCurrentIdentity={false}
      generateKey={() => undefined}
      handleAuthenticate={async () => undefined}
      handleDestroyKeyPair={() => undefined}
      handleRegisterIdentity={async () => undefined}
      hasSigningKeyPair
      identityBusy={null}
    />,
  );

  expect(view.queryByRole("button", { name: "Destroy Key Pair" })).toBeNull();
});

test("destroy key pair stands apart in the danger style", () => {
  let destroyed = 0;
  const view = render(
    <IdentityDestroyKeyPair
      disabled={false}
      onDestroy={() => {
        destroyed += 1;
      }}
    />,
  );

  const button = view.getByRole("button", { name: "Destroy Key Pair" });
  expect(button.classList.contains("mini-app-button--danger")).toBe(true);
  fireEvent.click(button);
  expect(destroyed).toBe(1);
  expect(
    view.getByText("Only your recovery phrase can restore it.", {
      exact: false,
    }),
  ).toBeTruthy();
});
