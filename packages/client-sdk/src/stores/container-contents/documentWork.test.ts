import { expect, test } from "bun:test";
import { runContainerDocumentWork } from "./documentWork";

test("document work recovers the root before moves and priming", async () => {
  const order: string[] = [];

  await expect(
    runContainerDocumentWork({
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
