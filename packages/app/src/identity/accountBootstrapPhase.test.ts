import { describe, expect, test } from "bun:test";
import {
  type AccountBootstrapInput,
  accountBootstrapCopy,
  resolveAccountBootstrapPhase,
} from "./accountBootstrapPhase";

// A fresh device mid-registration: the autopilot is armed, a key pair exists,
// restores have settled, and no account has signed in yet.
const REGISTERING: AccountBootstrapInput = {
  autoGenerateIdentity: true,
  autoProvisioningEnabled: true,
  autoRegisterIdentity: true,
  generation: "idle",
  hasSigningKey: true,
  identityDestroyed: false,
  identityRestored: false,
  identityTransitionInFlight: false,
  isAuthenticated: false,
  isLocked: false,
  localIdentityRestoreSettled: true,
  registration: "running",
  sessionRestoreSettled: true,
  systemBootstrapStatus: "running",
  userId: null,
};

function phaseOf(overrides: Partial<AccountBootstrapInput>) {
  return resolveAccountBootstrapPhase({ ...REGISTERING, ...overrides });
}

describe("resolveAccountBootstrapPhase", () => {
  test("an authenticated session is signed in whatever else is pending", () => {
    expect(
      phaseOf({ isAuthenticated: true, localIdentityRestoreSettled: false }),
    ).toBe("signed-in");
  });

  test("a new identity being registered is creating an account", () => {
    expect(phaseOf({})).toBe("creating-account");
    // Bootstrap still settling before the autopilot starts counts too.
    expect(
      phaseOf({ registration: "idle", systemBootstrapStatus: "waiting" }),
    ).toBe("creating-account");
  });

  test("a run that stored the user id but not yet the login still counts", () => {
    expect(phaseOf({ userId: "user-1" })).toBe("creating-account");
  });

  test("a restored identity without a session is signing in", () => {
    expect(phaseOf({ identityRestored: true })).toBe("signing-in");
  });

  test("stored identity or session loads report restoring", () => {
    expect(phaseOf({ localIdentityRestoreSettled: false })).toBe(
      "restoring-session",
    );
    expect(phaseOf({ identityTransitionInFlight: true })).toBe(
      "restoring-session",
    );
    expect(phaseOf({ sessionRestoreSettled: false })).toBe("restoring-session");
  });

  test("a missing key pair is being created only while the autopilot will", () => {
    expect(phaseOf({ hasSigningKey: false })).toBe("creating-identity");
    expect(phaseOf({ generation: "failed", hasSigningKey: false })).toBe(
      "signed-out",
    );
    expect(phaseOf({ hasSigningKey: false, identityDestroyed: true })).toBe(
      "signed-out",
    );
    expect(phaseOf({ autoGenerateIdentity: false, hasSigningKey: false })).toBe(
      "signed-out",
    );
    expect(
      phaseOf({ autoProvisioningEnabled: false, hasSigningKey: false }),
    ).toBe("signed-out");
  });

  test("nothing in flight asks the user to sign in", () => {
    // Explicit log out keeps the user id, so the autopilot stays idle.
    expect(phaseOf({ registration: "idle", userId: "user-1" })).toBe(
      "signed-out",
    );
    expect(phaseOf({ registration: "failed" })).toBe("signed-out");
    expect(
      phaseOf({ registration: "idle", systemBootstrapStatus: "error" }),
    ).toBe("signed-out");
    expect(phaseOf({ autoRegisterIdentity: false })).toBe("signed-out");
    expect(phaseOf({ autoProvisioningEnabled: false })).toBe("signed-out");
    expect(phaseOf({ isLocked: true })).toBe("signed-out");
  });
});

test("progress copy exists only for bootstrapping phases", () => {
  expect(accountBootstrapCopy("signed-in")).toBeNull();
  expect(accountBootstrapCopy("signed-out")).toBeNull();
  expect(accountBootstrapCopy("creating-account")?.title).toBe(
    "Creating your account",
  );
});
