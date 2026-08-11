import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { IdentityActionToolbar } from "./IdentityManagerActionToolbar";

test("destroy key pair uses the standard button style", () => {
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

  const button = view.getByRole("button", { name: "Destroy Key Pair" });
  expect(button.classList.contains("mini-app-button--ghost")).toBe(false);
});
