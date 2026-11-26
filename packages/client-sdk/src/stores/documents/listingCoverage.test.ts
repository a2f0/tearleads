import { expect, test } from "bun:test";
import { createDomainScope } from "../../data/shared/domainScope";
import { getOrCreateDocumentListingCoverage } from "./listingCoverage";

function hint(documentId: string) {
  return {
    containerIds: ["container-1"],
    documentId,
    type: "document_update_created",
    updateIds: [`update-${documentId}`],
  };
}

function installedCoverage() {
  const coverage = getOrCreateDocumentListingCoverage(createDomainScope());
  coverage.install({ listsContainer: () => true });
  return coverage;
}

test("a hint is remembered until the document's store takes it", () => {
  const coverage = installedCoverage();

  coverage.observeEvents([hint("a"), hint("b")]);

  expect(coverage.takeHint("a")).toBe(true);
  expect(coverage.takeHint("a")).toBe(false);
  expect(coverage.takeHint("b")).toBe(true);
  expect(coverage.takeHint("never-hinted")).toBe(false);
});

test("a store holding an older runtime's events does not replay taken hints", () => {
  const coverage = installedCoverage();
  const events = [hint("a"), hint("b")];

  coverage.observeEvents(events);
  expect(coverage.takeHint("b")).toBe(true);
  // A store the primer opened still observes the list as it was earlier.
  coverage.observeEvents(events.slice(0, 1));
  coverage.observeEvents(events);

  expect(coverage.takeHint("b")).toBe(false);
});

test("hints are not remembered without a listing authority", () => {
  const coverage = getOrCreateDocumentListingCoverage(createDomainScope());

  coverage.observeEvents([hint("a")]);

  // Every store probes on its own then, so nothing needs the hint.
  expect(coverage.takeHint("a")).toBe(false);
});

test("a lane whose last listing failed is not covered until it lists", () => {
  const coverage = installedCoverage();

  expect(coverage.coversContainer("container-1")).toBe(true);
  expect(coverage.coversContainer(null)).toBe(false);
  coverage.reportLaneListed("container-1", false);
  expect(coverage.coversContainer("container-1")).toBe(false);
  coverage.reportLaneListed("container-1", true);
  expect(coverage.coversContainer("container-1")).toBe(true);
});
