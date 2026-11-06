import { toFingerprint } from "../fingerprint";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import type { SignedTransparencyTreeHead } from "./index";
import {
  computeTransparencyMerkleRoot,
  signTransparencyTreeHead,
} from "./index";

export async function signTransparencyTreeHeadFixture(input: {
  readonly leafHashes: readonly string[];
  readonly logId?: string;
  readonly signing?: ReturnType<typeof generateSigningSeedAndKeyPair>;
}): Promise<{
  readonly treeHead: SignedTransparencyTreeHead;
  readonly signingPublicKey: Uint8Array;
}> {
  const signing = input.signing ?? generateSigningSeedAndKeyPair();
  const treeHead = await signTransparencyTreeHead(
    {
      version: 1,
      logId: input.logId ?? "keying-transparency-log",
      treeSize: input.leafHashes.length,
      rootHash: await computeTransparencyMerkleRoot(input.leafHashes),
      signedAt: "2026-04-27T12:00:00.000Z",
      logKeyFingerprint: await toFingerprint(signing.signingPublicKey),
    },
    signing.signingPrivateKey,
  );

  return {
    treeHead,
    signingPublicKey: signing.signingPublicKey,
  };
}
