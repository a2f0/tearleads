import { afterEach, expect, test } from "bun:test";
import { LEGAL_TERMS_VERSION } from "@tearleads/validators/legalTerms";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LEGAL_TERMS_AGREEMENT_LABEL } from "../../components/identity/legal-terms/LegalTermsAgreementPanel";
import {
  createLegalTermsAgreementStore,
  LegalTermsAgreementContext,
} from "../../identity/legalTermsAgreement";
import {
  DEMO_LEGAL_TERMS_STORAGE_KEY,
  DemoLegalTermsGate,
} from "./DemoLegalTermsGate";

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

function renderGate() {
  const store = createLegalTermsAgreementStore();
  const view = render(
    <LegalTermsAgreementContext.Provider value={store}>
      <DemoLegalTermsGate>
        <p>Panes</p>
      </DemoLegalTermsGate>
    </LegalTermsAgreementContext.Provider>,
  );
  return { store, view };
}

test("the demo's panes start only once the terms are agreed, and the device remembers that revision", async () => {
  const { store, view } = renderGate();
  view.getByRole("heading", { name: "Review our terms" });
  expect(view.queryByText("Panes")).toBeNull();
  // The page's one agreement has nothing before it to go back to.
  expect(view.queryByRole("button", { name: "Back" })).toBeNull();

  fireEvent.click(
    view.getByRole("checkbox", { name: LEGAL_TERMS_AGREEMENT_LABEL }),
  );
  fireEvent.click(view.getByRole("button", { name: "Continue" }));
  await view.findByText("Panes");
  expect(store.agreedVersion).toBe(LEGAL_TERMS_VERSION);
  expect(globalThis.localStorage.getItem(DEMO_LEGAL_TERMS_STORAGE_KEY)).toBe(
    LEGAL_TERMS_VERSION,
  );
});

test("a device that agreed to this revision opens the panes without asking", async () => {
  globalThis.localStorage.setItem(
    DEMO_LEGAL_TERMS_STORAGE_KEY,
    LEGAL_TERMS_VERSION,
  );
  const { store, view } = renderGate();
  await view.findByText("Panes");
  expect(view.queryByRole("heading", { name: "Review our terms" })).toBeNull();
  expect(store.agreedVersion).toBe(LEGAL_TERMS_VERSION);
});

test("an earlier revision's agreement asks again", () => {
  globalThis.localStorage.setItem(DEMO_LEGAL_TERMS_STORAGE_KEY, "2000-01-01");
  const { store, view } = renderGate();
  view.getByRole("heading", { name: "Review our terms" });
  expect(view.queryByText("Panes")).toBeNull();
  expect(store.agreedVersion).toBeNull();
});
