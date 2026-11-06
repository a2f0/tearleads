import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { toFingerprint } from "../fingerprint";
import { sign } from "../signing/sign";
import { verify } from "../signing/verify";
import { encodeDomainPayload } from "./canonical";
import type { KeyingCanonicalPayload } from "./canonicalJsonTypes";
import {
  assertExactKeys,
  readHashString,
  readNonNegativeInteger,
  readSignedAt,
  readString,
  readVersion,
  runVerifier,
  throwVerification,
} from "./shared";
import {
  computeTransparencyLeafHash,
  normalizeTransparencyLeaf,
} from "./transparencyLeaf";
import {
  assertTransparencyConsistency,
  assertTransparencyInclusion,
  normalizeTransparencyConsistencyProof,
  normalizeTransparencyInclusionProof,
} from "./transparencyProofs";
import type {
  SignedTransparencyTreeHead,
  TransparencyConsistencyProof,
  TransparencyTreeCheckpoint,
  UnsignedTransparencyTreeHead,
  VerifiedTransparencyProof,
  VerifiedTransparencyTreeHead,
  VerifySignedTransparencyTreeHeadInput,
  VerifyTransparencyProofInput,
} from "./transparencyTypes";
import {
  makeVerifiedTransparencyProof,
  makeVerifiedTransparencyTreeHead,
} from "./transparencyTypes";
import type { KeyingVerificationResult } from "./verificationError";

function normalizeUnsignedTransparencyTreeHead(
  value: unknown,
): UnsignedTransparencyTreeHead {
  const record = assertExactKeys(
    value,
    [
      "logId",
      "logKeyFingerprint",
      "rootHash",
      "signedAt",
      "treeSize",
      "version",
    ],
    "transparency tree head",
  );

  return {
    version: readVersion(record, "transparency tree head"),
    logId: readString(record, "logId", "transparency tree head"),
    treeSize: readNonNegativeInteger(
      record,
      "treeSize",
      "transparency tree head",
    ),
    rootHash: readHashString(record, "rootHash", "transparency tree head"),
    signedAt: readSignedAt(record, "signedAt", "transparency tree head"),
    logKeyFingerprint: readHashString(
      record,
      "logKeyFingerprint",
      "transparency tree head",
    ),
  };
}

function normalizeSignedTransparencyTreeHead(
  value: unknown,
): SignedTransparencyTreeHead {
  const record = assertExactKeys(
    value,
    [
      "logId",
      "logKeyFingerprint",
      "rootHash",
      "signature",
      "signedAt",
      "treeSize",
      "version",
    ],
    "transparency tree head",
  );
  const unsignedHead = normalizeUnsignedTransparencyTreeHead({
    version: record.version,
    logId: record.logId,
    treeSize: record.treeSize,
    rootHash: record.rootHash,
    signedAt: record.signedAt,
    logKeyFingerprint: record.logKeyFingerprint,
  });

  return {
    ...unsignedHead,
    signature: readString(record, "signature", "transparency tree head"),
  };
}

function transparencyTreeHeadSigningBytes(
  treeHead: UnsignedTransparencyTreeHead,
): Uint8Array {
  const payload: KeyingCanonicalPayload<UnsignedTransparencyTreeHead> =
    normalizeUnsignedTransparencyTreeHead(treeHead);

  return encodeDomainPayload(
    "tearleads.keying.transparency-tree-head-signing",
    payload,
  );
}

function toUnsignedTransparencyTreeHead(
  treeHead: SignedTransparencyTreeHead,
): UnsignedTransparencyTreeHead {
  return {
    version: treeHead.version,
    logId: treeHead.logId,
    treeSize: treeHead.treeSize,
    rootHash: treeHead.rootHash,
    signedAt: treeHead.signedAt,
    logKeyFingerprint: treeHead.logKeyFingerprint,
  };
}

export async function signTransparencyTreeHead(
  treeHead: UnsignedTransparencyTreeHead,
  signingPrivateKey: Uint8Array,
): Promise<SignedTransparencyTreeHead> {
  const normalizedTreeHead = normalizeUnsignedTransparencyTreeHead(treeHead);
  const signature = sign(
    transparencyTreeHeadSigningBytes(normalizedTreeHead),
    signingPrivateKey,
  );

  return {
    ...normalizedTreeHead,
    signature: bytesToBase64(signature),
  };
}

function transparencyTreeCheckpointFromHead(
  treeHead: UnsignedTransparencyTreeHead,
): TransparencyTreeCheckpoint {
  return {
    logId: treeHead.logId,
    treeSize: treeHead.treeSize,
    rootHash: treeHead.rootHash,
  };
}

export async function verifySignedTransparencyTreeHead({
  logPublicKey,
  treeHead,
}: VerifySignedTransparencyTreeHeadInput): Promise<
  KeyingVerificationResult<VerifiedTransparencyTreeHead>
> {
  return runVerifier(async () => {
    const normalizedTreeHead = normalizeSignedTransparencyTreeHead(treeHead);
    const logKeyFingerprint = await toFingerprint(logPublicKey);
    if (logKeyFingerprint !== normalizedTreeHead.logKeyFingerprint) {
      throwVerification(
        "signer_mismatch",
        "transparency tree head log key fingerprint does not match public key",
      );
    }

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(normalizedTreeHead.signature);
    } catch {
      throwVerification(
        "signature_mismatch",
        "transparency tree head signature invalid",
      );
    }

    if (
      !verify(
        signature,
        transparencyTreeHeadSigningBytes(
          toUnsignedTransparencyTreeHead(normalizedTreeHead),
        ),
        logPublicKey,
      )
    ) {
      throwVerification(
        "signature_mismatch",
        "transparency tree head signature verification failed",
      );
    }

    return makeVerifiedTransparencyTreeHead({
      treeHead: normalizedTreeHead,
      checkpoint: transparencyTreeCheckpointFromHead(normalizedTreeHead),
    });
  });
}

export async function verifyTransparencyProof({
  consistencyProof,
  inclusionProof,
  leaf,
  logPublicKey,
  previousTreeHead,
  treeHead,
}: VerifyTransparencyProofInput): Promise<
  KeyingVerificationResult<VerifiedTransparencyProof>
> {
  return runVerifier(async () => {
    const verifiedTreeHead = await verifySignedTransparencyTreeHead({
      treeHead,
      logPublicKey,
    });

    if (!verifiedTreeHead.ok) {
      throw verifiedTreeHead.error;
    }

    const normalizedLeaf = normalizeTransparencyLeaf(leaf);
    const leafHash = await computeTransparencyLeafHash(normalizedLeaf);
    const normalizedInclusionProof =
      normalizeTransparencyInclusionProof(inclusionProof);

    await assertTransparencyInclusion({
      leafHash,
      proof: normalizedInclusionProof,
      checkpoint: verifiedTreeHead.value.checkpoint,
    });

    let normalizedConsistencyProof: TransparencyConsistencyProof | undefined;

    if (previousTreeHead || consistencyProof) {
      if (!previousTreeHead || !consistencyProof) {
        throwVerification(
          "missing_dependency",
          "transparency consistency verification requires both previous tree head and proof",
        );
      }

      const verifiedPreviousTreeHead = await verifySignedTransparencyTreeHead({
        treeHead: previousTreeHead,
        logPublicKey,
      });

      if (!verifiedPreviousTreeHead.ok) {
        throw verifiedPreviousTreeHead.error;
      }

      normalizedConsistencyProof =
        normalizeTransparencyConsistencyProof(consistencyProof);
      await assertTransparencyConsistency({
        proof: normalizedConsistencyProof,
        previousCheckpoint: verifiedPreviousTreeHead.value.checkpoint,
        checkpoint: verifiedTreeHead.value.checkpoint,
      });
    }

    return makeVerifiedTransparencyProof({
      leaf: normalizedLeaf,
      leafHash,
      treeHead: verifiedTreeHead.value,
      inclusionProof: normalizedInclusionProof,
      ...(normalizedConsistencyProof
        ? { consistencyProof: normalizedConsistencyProof }
        : {}),
    });
  });
}
