import { expect, test } from "bun:test";
import { createDomainScope } from "../../../data/shared/domainScope";
import { getOrCreateTreeCatchUp } from "./treeCatchUp";
import {
  NO_TREE_CATCH_UP,
  type TreeCatchUpState,
  transitionTreeCatchUp,
} from "./treeCatchUpMachine";

const owed: TreeCatchUpState = { status: "owed" };
const complete: TreeCatchUpState = { status: "complete" };
const incomplete: TreeCatchUpState = { status: "incomplete" };
const settled = (isComplete: boolean) =>
  ({ complete: isComplete, type: "settled" }) as const;

test("an acknowledged connection owes a crawl whatever came before", () => {
  for (const state of [NO_TREE_CATCH_UP, owed, complete, incomplete]) {
    expect(transitionTreeCatchUp(state, { type: "owed" })).toEqual(owed);
  }
});

test("an owed crawl settles as complete or incomplete", () => {
  expect(transitionTreeCatchUp(owed, settled(true))).toEqual(complete);
  expect(transitionTreeCatchUp(owed, settled(false))).toEqual(incomplete);
});

test("a retry can complete an incomplete crawl, and nothing undoes a complete one", () => {
  expect(transitionTreeCatchUp(incomplete, settled(true))).toEqual(complete);
  expect(transitionTreeCatchUp(incomplete, settled(false))).toBe(incomplete);
  expect(transitionTreeCatchUp(complete, settled(false))).toBe(complete);
  // A crawl that no acknowledged connection owed vouches for nothing.
  expect(transitionTreeCatchUp(NO_TREE_CATCH_UP, settled(true))).toBe(
    NO_TREE_CATCH_UP,
  );
});

test("a scope has one port, and nothing vouches before an acknowledged crawl", async () => {
  const domainScope = createDomainScope();
  const port = getOrCreateTreeCatchUp(domainScope);

  expect(getOrCreateTreeCatchUp(domainScope)).toBe(port);
  expect(getOrCreateTreeCatchUp(createDomainScope())).not.toBe(port);
  expect(await port.whenCrawlSettles()).toBe(false);
});

test("whoever asks while a crawl is owed is told how it settles", async () => {
  const port = getOrCreateTreeCatchUp(createDomainScope());
  port.crawlOwed();
  const first = port.whenCrawlSettles();
  const second = port.whenCrawlSettles();
  let told = false;
  void first.then(() => {
    told = true;
  });
  await Promise.resolve();
  expect(told).toBe(false);

  port.crawlSettled(true);

  expect(await first).toBe(true);
  expect(await second).toBe(true);
  // The answer stands until the next acknowledged connection.
  expect(await port.whenCrawlSettles()).toBe(true);
  port.crawlOwed();
  const next = port.whenCrawlSettles();
  port.crawlSettled(false);
  expect(await next).toBe(false);
  expect(await port.whenCrawlSettles()).toBe(false);
  // A retry of that crawl that completes vouches from then on.
  port.crawlSettled(true);
  expect(await port.whenCrawlSettles()).toBe(true);
});
