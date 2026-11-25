import { afterEach, expect, spyOn, test } from "bun:test";
import type { TwoFactorStatus } from "@tearleads/client-sdk";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as TearleadsProvider from "../../../providers/sdk/TearleadsProvider";
import { IdentityManagerTwoFactorSection } from "./IdentityManagerTwoFactorSection";

afterEach(cleanup);

type Model = Parameters<typeof IdentityManagerTwoFactorSection>[0]["model"];
const SIGNED_IN = { canManageSessions: true } as unknown as Model;

function fakeTwoFactor(initial: TwoFactorStatus) {
  let current = initial;
  const calls: string[] = [];
  return {
    calls,
    twoFactor: {
      beginSetup: async () => {
        calls.push("setup");
        return {
          otpauthUri: "otpauth://totp/Tearleads:abc",
          secret: "ABCDEFGH",
        };
      },
      disable: async () => {
        calls.push("disable");
      },
      enable: async (code: string, options: { rememberDevice?: boolean }) => {
        calls.push(`enable:${code}:${String(options.rememberDevice)}`);
        current = {
          enabled: true,
          recoveryCodesRemaining: 2,
          requiredByOrganizationIds: [],
          sessionVerified: true,
        };
        return ["aaaaa-bbbbb", "ccccc-ddddd"];
      },
      regenerateRecoveryCodes: async () => ["eeeee-fffff"],
      status: async () => current,
    },
  };
}

function renderSection(fake: ReturnType<typeof fakeTwoFactor>) {
  const spy = spyOn(TearleadsProvider, "useTearleads").mockReturnValue({
    twoFactor: fake.twoFactor,
  } as unknown as ReturnType<typeof TearleadsProvider.useTearleads>);
  render(<IdentityManagerTwoFactorSection model={SIGNED_IN} />);
  return spy;
}

test("setting up shows the key, then the recovery codes once, then on", async () => {
  const fake = fakeTwoFactor({
    enabled: false,
    recoveryCodesRemaining: 0,
    requiredByOrganizationIds: ["org-1"],
    sessionVerified: false,
  });
  const spy = renderSection(fake);
  try {
    expect(
      await screen.findByText(/An organization you belong to requires/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(
      await screen.findByAltText("Authenticator setup QR code"),
    ).toBeTruthy();
    expect(screen.getByText("ABCD EFGH")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("123456"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByLabelText("Remember this device for 30 days"));
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));

    const codes = await screen.findByRole("list", { name: "Recovery codes" });
    expect(codes.textContent).toContain("aaaaa-bbbbb");
    expect(fake.calls).toEqual(["setup", "enable:123456:true"]);

    fireEvent.click(screen.getByRole("button", { name: "I saved them" }));
    await waitFor(() => {
      expect(screen.getByText("Recovery codes left")).toBeTruthy();
    });
    expect(screen.queryByText("aaaaa-bbbbb")).toBeNull();
  } finally {
    spy.mockRestore();
  }
});

test("a wrong code keeps the setup and says why", async () => {
  const fake = fakeTwoFactor({
    enabled: false,
    recoveryCodesRemaining: 0,
    requiredByOrganizationIds: [],
    sessionVerified: false,
  });
  const { TwoFactorRequestError } = await import("@tearleads/client-sdk");
  fake.twoFactor.enable = async () => {
    throw new TwoFactorRequestError("bad", "two_factor_invalid", 400);
  };
  const spy = renderSection(fake);
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Set up" }));
    fireEvent.change(await screen.findByPlaceholderText("123456"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));

    expect(
      await screen.findByText("That code did not match. Try again."),
    ).toBeTruthy();
    expect(screen.getByAltText("Authenticator setup QR code")).toBeTruthy();
  } finally {
    spy.mockRestore();
  }
});
