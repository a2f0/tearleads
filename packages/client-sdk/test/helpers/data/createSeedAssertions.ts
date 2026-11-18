import { expect } from "bun:test";
import {
  documentCreateSeedSyncRequest,
  isDocumentSyncRequest,
} from "@tearleads/validators/request";

/** A seed carries its update alone; the API rebuilds the sync from `create`. */
export function expectSeedOnly(
  create: Parameters<typeof documentCreateSeedSyncRequest>[0],
  seed: Parameters<typeof documentCreateSeedSyncRequest>[1],
): void {
  expect(Object.keys(seed)).toEqual(["outgoingUpdates"]);
  expect(seed.outgoingUpdates).toHaveLength(1);
  expect(
    isDocumentSyncRequest(documentCreateSeedSyncRequest(create, seed)),
  ).toBe(true);
}
