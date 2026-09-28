import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import type {
  KeyingCanonicalJson,
  VerifiedDocumentLinkSetManifest,
} from "@tearleads/crypto";
import { signedDocumentHistory } from "../../../test/helpers/storedDocumentHistory";
import { createContainerWriterProjectionContext } from "../containers/writerProjection/context";
import { toManifestBundleResponse } from "../containers/writerProjection/records";
import { verifyStoredDocumentManifest } from "./storedDocumentManifestVerification";

test("a cold document verifier accepts a long retained link history", async () => {
  const head = await signedDocumentHistory(4_098);
  const verifiedByHash = new Map<string, VerifiedDocumentLinkSetManifest>();
  const verified = await verifyStoredDocumentManifest({
    bundle: toManifestBundleResponse({
      ...head,
      state: head.state as unknown as KeyingCanonicalJson,
    }),
    containerContext: createContainerWriterProjectionContext(db),
    verifiedByHash,
  });
  expect(verified.manifestHash).toBe(head.manifestHash);
  expect(verifiedByHash.size).toBe(4_098);
}, 300_000);
