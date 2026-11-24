import { expect, test } from "bun:test";
import { createDomainScope } from "../../../data/shared/domainScope";
import type { DocumentStoreState } from "./state";
import { createStoredDocument, storedDocumentPeer } from "./storedDocument";

async function peerOf(input: {
  readonly domainScope: object;
  readonly localId: string;
  readonly peerSalt?: string;
  readonly peerScope?: string;
  readonly userId: string;
}): Promise<string> {
  const state = {
    localId: input.localId,
    runtime: {
      auth: { userId: input.userId },
      state: {
        domainScope: input.domainScope,
        peerScope: input.peerScope ?? null,
      },
    },
  } as unknown as DocumentStoreState;
  const doc = await createStoredDocument(state, input.peerSalt);
  try {
    return doc.peerIdStr;
  } finally {
    doc.free();
  }
}

test("a store writes each record under its own peer for its user", async () => {
  const domainScope = createDomainScope();
  const alice = { domainScope, localId: "doc-1", userId: "alice" };
  const first = await peerOf(alice);

  // Loading the record again in the same runtime keeps its peer.
  expect(await peerOf(alice)).toBe(first);
  // Another record, or another identity on this runtime, never shares it, so
  // a peer the server saw on one document names nothing on another, and two
  // identities never write one history under one peer.
  expect(await peerOf({ ...alice, localId: "doc-2" })).not.toBe(first);
  expect(await peerOf({ ...alice, userId: "bob" })).not.toBe(first);
  // Neither does another pane or runtime.
  expect(await peerOf({ ...alice, peerScope: "pane-2" })).not.toBe(first);
  expect(await peerOf({ ...alice, domainScope: createDomainScope() })).not.toBe(
    first,
  );
});

test("a salted record writes on the peer its rebase moved it to", async () => {
  const alice = {
    domainScope: createDomainScope(),
    localId: "doc-1",
    userId: "alice",
  };
  const state = {
    localId: alice.localId,
    runtime: {
      auth: { userId: alice.userId },
      state: { domainScope: alice.domainScope, peerScope: null },
    },
  } as unknown as DocumentStoreState;
  const salted = await peerOf({ ...alice, peerSalt: "salt" });

  expect(salted).not.toBe(await peerOf(alice));
  expect(await peerOf({ ...alice, peerSalt: "salt" })).toBe(salted);
  expect<string>(await storedDocumentPeer(state, "salt")).toBe(salted);
});
