import { afterEach, expect, spyOn, test } from "bun:test";
import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
import { fireEvent, waitFor, within } from "@testing-library/react";
import invariant from "invariant";
import {
  answerAccountNamePrompt,
  chooseNewIdentity,
  confirmRecoveryKeyBackup,
  waitForPaneKey,
} from "../../test/helpers/accountNamePrompt";
import { openIdentityManagerFromPane } from "../../test/helpers/identityPaneTestUtils";
import {
  MOCK_SERVER_RESET_TIMEOUT_MS,
  useTestApiAppHandlers,
} from "../../test/helpers/msw/server";
import { renderLifecyclePane } from "../../test/helpers/paneLifecycleTestUtils";
import {
  cleanupPaneTestEnvironment,
  clickPaneAppMenuItem,
  createTestHostConfig,
  generateIdentityAndWaitForDb,
  getPaneStatusText,
  PANE_ASYNC_TEST_TIMEOUT_MS,
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS,
  renderPane,
  waitForPaneRuntimeToSettle,
} from "../../test/helpers/paneTestUtils";
import { LEGAL_TERMS_AGREEMENT_LABEL } from "../components/identity/legal-terms/LegalTermsAgreementPanel";
import { createLegalTermsAgreementStore } from "./legalTermsAgreement";

afterEach(cleanupPaneTestEnvironment, MOCK_SERVER_RESET_TIMEOUT_MS);

/** Checks the agreement shown anywhere in `container`, then continues. */
async function agreeToLegalTerms(container: HTMLElement): Promise<void> {
  const [agreement] = await within(container).findAllByRole(
    "checkbox",
    { name: LEGAL_TERMS_AGREEMENT_LABEL },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
  invariant(agreement, "Expected the legal terms agreement");
  const form = agreement.closest("form");
  invariant(form, "Expected the agreement form");
  const proceed = within(form).getByRole("button", { name: "Continue" });
  // Nothing continues until the box is checked.
  expect(proceed).toHaveProperty("disabled", true);
  fireEvent.click(agreement);
  fireEvent.click(proceed);
}

async function waitForRegistration(
  view: ReturnType<typeof renderLifecyclePane>["view"],
): Promise<void> {
  await waitFor(
    () => {
      expect(getPaneStatusText(view)).not.toMatch(/userId:\s*none/);
    },
    { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
  );
}

test(
  "creating an identity shows the legal terms first, and its registration records the agreed revision",
  async () => {
    useTestApiAppHandlers();
    const legalTerms = createLegalTermsAgreementStore();
    const { sdk, view } = renderLifecyclePane(
      createTestHostConfig({
        autoProvisionIdentity: true,
        promptAccountName: true,
      }),
      { legalTermsAgreement: legalTerms },
    );
    const manager = await openIdentityManagerFromPane(view);
    await chooseNewIdentity(manager);
    const register = spyOn(sdk().session, "registerIdentity");

    // Both documents show, in the text the website publishes.
    await within(manager).findByRole(
      "heading",
      { name: "Review our terms" },
      { timeout: PANE_LONG_ASYNC_TEST_TIMEOUT_MS },
    );
    within(manager).getByRole("heading", { name: "1. The agreement" });
    fireEvent.click(
      within(manager).getByRole("tab", { name: "Privacy Policy" }),
    );
    within(manager).getByRole("heading", {
      name: "1. Who we are and what this covers",
    });
    expect(sdk().identity.signingKeyPair).toBeNull();

    await agreeToLegalTerms(manager);
    expect(legalTerms.agreedVersion).toBe(LEGAL_TERMS_VERSION);
    await answerAccountNamePrompt(manager);
    await confirmRecoveryKeyBackup(manager);
    await waitForRegistration(view);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
      rosterProfileNickname: "Bob",
    });
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 4,
);

test(
  "an automatically created identity holds its registration, and every app, until the terms are agreed",
  async () => {
    useTestApiAppHandlers();
    const legalTerms = createLegalTermsAgreementStore();
    const { sdk, view } = renderLifecyclePane(
      createTestHostConfig({ autoProvisionIdentity: true }),
      { legalTermsAgreement: legalTerms },
    );
    await waitForPaneKey(view);
    const register = spyOn(sdk().session, "registerIdentity");
    await waitForPaneRuntimeToSettle(PANE_ASYNC_TEST_TIMEOUT_MS);
    expect(register).not.toHaveBeenCalled();
    expect(getPaneStatusText(view)).toMatch(/userId:\s*none/);

    // An app opened meanwhile asks for the agreement instead of opening.
    fireEvent.contextMenu(view.getByRole("application"), {
      clientX: 120,
      clientY: 120,
    });
    clickPaneAppMenuItem(view, "Contacts");
    const contacts = await waitFor(() => {
      const window = Array.from(
        view.container.querySelectorAll<HTMLElement>(".window"),
      ).find(
        (candidate) =>
          candidate.querySelector(".window-titlebar-title")?.textContent ===
          "Contacts",
      );
      invariant(window, "Expected the Contacts window");
      return window;
    });
    await within(contacts).findByRole("heading", { name: "Review our terms" });
    expect(contacts.querySelector(".contacts")).toBeNull();
    // With no onboarding step before it, there is nothing to go back to.
    expect(within(contacts).queryByRole("button", { name: "Back" })).toBe(null);
    await agreeToLegalTerms(contacts);
    await waitForRegistration(view);
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
    });
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 4,
);

test(
  "a manual Register shows the legal terms first and registers once they are agreed",
  async () => {
    useTestApiAppHandlers();
    const legalTerms = createLegalTermsAgreementStore();
    const view = renderPane({ legalTermsAgreement: legalTerms });
    await generateIdentityAndWaitForDb(view);
    const manager = await openIdentityManagerFromPane(view);
    const register = await within(manager).findByRole("button", {
      name: "Register",
    });
    fireEvent.click(register);
    await within(manager).findByRole("heading", { name: "Review our terms" });
    // Back cancels without registering, and Register asks again.
    const agreementForm = within(manager)
      .getByRole("checkbox", { name: LEGAL_TERMS_AGREEMENT_LABEL })
      .closest("form");
    invariant(agreementForm, "Expected the agreement form");
    fireEvent.click(
      within(agreementForm).getByRole("button", { name: "Back" }),
    );
    fireEvent.click(
      await within(manager).findByRole("button", { name: "Register" }),
    );
    await agreeToLegalTerms(manager);
    await waitForRegistration(view);
    expect(legalTerms.agreedVersion).toBe(LEGAL_TERMS_VERSION);
    await waitForPaneRuntimeToSettle(PANE_LONG_ASYNC_TEST_TIMEOUT_MS);
  },
  PANE_LONG_ASYNC_TEST_TIMEOUT_MS * 4,
);
