import { expect, test } from "bun:test";
import { runContainerDocumentWork } from "./documentWork";

test("document work recovers the root before moves and priming", async () => {
  const order: string[] = [];

  await expect(
    runContainerDocumentWork({
      isCurrent: () => true,
      onContextChanged: () => order.push("context-change"),
      onDocumentsMoved: () => order.push("move-effects"),
      primeDocuments: async () => {
        order.push("prime");
      },
      recoverStaleRoot: async () => {
        order.push("recover");
        return "reassigned";
      },
      shouldPrimeDocuments: () => true,
      syncPendingDocumentMoves: async () => {
        order.push("moves");
        return 1;
      },
    }),
  ).resolves.toBe("completed");
  expect(order).toEqual(["recover", "moves", "move-effects", "prime"]);
});

test("a changed recovery context stops later document work", async () => {
  const order: string[] = [];

  await expect(
    runContainerDocumentWork({
      isCurrent: () => true,
      onContextChanged: () => order.push("context-change"),
      onDocumentsMoved: () => order.push("move-effects"),
      primeDocuments: async () => {
        order.push("prime");
      },
      recoverStaleRoot: async () => {
        order.push("recover");
        return "context-changed";
      },
      shouldPrimeDocuments: () => true,
      syncPendingDocumentMoves: async () => {
        order.push("moves");
        return 1;
      },
    }),
  ).resolves.toBe("context-changed");
  expect(order).toEqual(["recover", "context-change"]);
});

test("document work skips empty move effects and disabled priming", async () => {
  const order: string[] = [];

  await expect(
    runContainerDocumentWork({
      isCurrent: () => true,
      onContextChanged: () => order.push("context-change"),
      onDocumentsMoved: () => order.push("move-effects"),
      primeDocuments: async () => {
        order.push("prime");
      },
      recoverStaleRoot: async () => {
        order.push("recover");
        return "not-needed";
      },
      shouldPrimeDocuments: () => false,
      syncPendingDocumentMoves: async () => {
        order.push("moves");
        return 0;
      },
    }),
  ).resolves.toBe("completed");
  expect(order).toEqual(["recover", "moves"]);
});

test("a generation change during root recovery abandons later work", async () => {
  const order: string[] = [];
  let current = true;

  await expect(
    runContainerDocumentWork({
      isCurrent: () => current,
      onContextChanged: () => order.push("context-change"),
      onDocumentsMoved: () => order.push("move-effects"),
      primeDocuments: async () => {
        order.push("prime");
      },
      recoverStaleRoot: async () => {
        order.push("recover");
        current = false;
        return "not-needed";
      },
      shouldPrimeDocuments: () => true,
      syncPendingDocumentMoves: async () => {
        order.push("moves");
        return 1;
      },
    }),
  ).resolves.toBe("abandoned");
  expect(order).toEqual(["recover"]);
});

test("a generation change during document moves skips effects and priming", async () => {
  const order: string[] = [];
  let current = true;

  await expect(
    runContainerDocumentWork({
      isCurrent: () => current,
      onContextChanged: () => order.push("context-change"),
      onDocumentsMoved: () => order.push("move-effects"),
      primeDocuments: async () => {
        order.push("prime");
      },
      recoverStaleRoot: async () => {
        order.push("recover");
        return "not-needed";
      },
      shouldPrimeDocuments: () => true,
      syncPendingDocumentMoves: async () => {
        order.push("moves");
        current = false;
        return 1;
      },
    }),
  ).resolves.toBe("abandoned");
  expect(order).toEqual(["recover", "moves"]);
});
