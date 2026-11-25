import { expect, test } from "bun:test";
import { LegalTermsOutdatedError } from "@tearleads/client-sdk";
import {
  autoRegisterFailureMessage,
  LEGAL_TERMS_OUTDATED_APP_MESSAGE,
  RegistrationRecoveryError,
  registrationFailureMessage,
} from "./registrationRecoveryError";

test("autopilot logs preserve recovery guidance and distinguish offline failures", () => {
  expect(
    autoRegisterFailureMessage(new RegistrationRecoveryError(true)),
  ).toContain("Auto-register identity failed:");
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

test("a build showing an earlier legal terms revision asks for an update, not a sign-in", () => {
  const outdated = new LegalTermsOutdatedError("2000-01-01");
  expect(registrationFailureMessage(outdated)).toBe(
    LEGAL_TERMS_OUTDATED_APP_MESSAGE,
  );
  expect(autoRegisterFailureMessage(outdated)).toBe(
    `Auto-register identity failed: ${LEGAL_TERMS_OUTDATED_APP_MESSAGE}`,
  );
  expect(registrationFailureMessage(new Error("server-controlled"))).toBe(
    "Could not register key.",
  );
});
