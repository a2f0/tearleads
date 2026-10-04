import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { db } from "@tearleads/api-shared/postgres";
import {
  principalContainerGrantProjection,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import {
  computePrincipalStateHash,
  type SignedPrincipalState,
  type UnsignedPrincipalState,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../src/access/write/principalMemberEnvelopes";
import { signPrincipalStateBundle } from "./principalState";

function signBatch(
  worker: Worker,
  states: UnsignedPrincipalState[],
  signingPrivateKey: Uint8Array,
): Promise<SignedPrincipalState[]> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      worker.off("message", receive);
      reject(error);
    };
    const receive = (signed: SignedPrincipalState[]) => {
      worker.off("error", fail);
      resolve(signed);
    };
    worker.once("error", fail);
    worker.once("message", receive);
    worker.postMessage({ states, signingPrivateKey });
  });
}

/**
 * Seed complete, genuinely signed histories in bounded batches. Running every
 * historical mutation through HTTP would repeatedly verify growing prefixes.
 * The test submits the boundary mutation normally and cold-verifies every link.
 */
export async function seedLongPrincipalHistory(input: {
  actor: TestUser;
  policy: PrincipalPolicyBundleResponse;
  throughVersion: number;
  payloadCiphertext?: string;
}) {
  const { actor, policy } = input;
  const template = await signPrincipalStateBundle({
    ...policy.currentState,
    payloadCiphertext:
      input.payloadCiphertext ?? policy.currentPayload.ciphertext,
    members: policy.currentProjection.map(({ userId }) => ({ userId })),
    projection: policy.currentProjection,
    grants: policy.currentGrants,
    memberEnvelopes: policy.currentMemberEnvelopes.envelopes,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });
  let previous = policy.currentState;
  const workers = Array.from(
    {
      length: Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2))),
    },
    () => new Worker(new URL("./principalHistorySigner.ts", import.meta.url)),
  );
  try {
    for (
      let start = previous.version + 1;
      start <= input.throughVersion;
      start += 400
    ) {
      // State hashes exclude signatures. Build the contiguous hash chain first,
      // then sign independent headers in parallel without weakening the proof.
      const unsigned: UnsignedPrincipalState[] = [];
      let previousHash = previous.stateHash;
      const stateHashes = new Map<number, string>();
      for (
        let version = start;
        version <= Math.min(start + 399, input.throughVersion);
        version += 1
      ) {
        const state = {
          ...template.state,
          version,
          prevStateHash: previousHash,
        };
        previousHash = await computePrincipalStateHash(state);
        stateHashes.set(version, previousHash);
        unsigned.push(state);
      }
      const chunkSize = Math.ceil(unsigned.length / workers.length);
      const signed = (
        await Promise.all(
          workers.map((worker, index) =>
            signBatch(
              worker,
              unsigned.slice(index * chunkSize, (index + 1) * chunkSize),
              actor.signing.signingPrivateKey,
            ),
          ),
        )
      ).flat();
      for (let offset = 0; offset < signed.length; offset += 100) {
        const states: (typeof principalStates.$inferInsert)[] = [];
        const payloads: (typeof principalStatePayloads.$inferInsert)[] = [];
        const members: (typeof principalMembershipProjection.$inferInsert)[] =
          [];
        const grants: (typeof principalContainerGrantProjection.$inferInsert)[] =
          [];
        for (const state of signed.slice(offset, offset + 100)) {
          const stateHash = stateHashes.get(state.version);
          if (!stateHash) throw new Error("Missing fixture state hash");
          const identity = {
            principalType: state.principalType,
            principalId: state.principalId,
            stateHash,
          };
          states.push({
            ...state,
            stateHash,
            signedAt: new Date(state.signedAt),
          });
          payloads.push({ ...identity, ...template.encryptedPayload });
          for (const member of template.projection)
            members.push({ ...identity, ...member });
          for (const grant of template.grants)
            grants.push({ ...identity, ...grant });
          previous = { ...state, stateHash, createdAt: state.signedAt };
        }
        await db.transaction(async (tx) => {
          await tx.insert(principalStates).values(states);
          await tx.insert(principalStatePayloads).values(payloads);
          if (members.length)
            await tx.insert(principalMembershipProjection).values(members);
          if (grants.length)
            await tx.insert(principalContainerGrantProjection).values(grants);
        });
      }
    }
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
  await db.transaction((tx) =>
    replaceCurrentPrincipalMemberEnvelopesInTransaction(
      {
        principalType: previous.principalType,
        principalId: previous.principalId,
        stateHash: previous.stateHash,
        envelopes: policy.currentMemberEnvelopes.envelopes,
      },
      tx,
    ),
  );
  return previous;
}
