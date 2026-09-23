import { expect, test } from "bun:test";
import {
  autoRegisterFailureMessage,
  RegistrationRecoveryError,
} from "./registrationRecoveryError";

test("autopilot logs preserve recovery guidance and distinguish offline failures", () => {
  expect(
    autoRegisterFailureMessage(new RegistrationRecoveryError(true)),
  ).toContain("Auto-register identity refused:");
  expect(
    autoRegisterFailureMessage(new RegistrationRecoveryError(true)),
  ).toContain("clear local app data");
  const offline = autoRegisterFailureMessage(
    new RegistrationRecoveryError(false),
  );
  expect(offline).toContain("no network connection");
  expect(offline).not.toContain("clear local app data");
  expect(
    autoRegisterFailureMessage(new Error("server-controlled message")),
  ).toBe("Failed to auto-register identity");
});
