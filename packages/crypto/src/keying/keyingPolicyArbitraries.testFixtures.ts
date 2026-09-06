import fc from "fast-check";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import { granteeArb, POOL_SIZE } from "./keyingArbitraries.testFixtures";
import {
  createBundle,
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";

/**
 * Principal-policy generators for the keying property suite (#2192 Gate
 * F2): plans of additive and shrinking successors materialized into signed
 * policy chains, with the encapsulation key pair rotated on every shrink as
 * the verifier requires and retained per version.
 */

type PolicyStepPlan =
  | { readonly kind: "add"; readonly user: number }
  | { readonly kind: "remove"; readonly user: number };

interface PolicyChainPlan {
  readonly initial: readonly number[];
  readonly steps: readonly PolicyStepPlan[];
}

export const policyChainPlanArb: fc.Arbitrary<PolicyChainPlan> = fc.record({
  initial: fc.uniqueArray(granteeArb, { maxLength: POOL_SIZE - 1 }),
  steps: fc.array(
    fc.oneof(
      fc.record({ kind: fc.constant("add" as const), user: granteeArb }),
      fc.record({ kind: fc.constant("remove" as const), user: granteeArb }),
    ),
    { maxLength: 3 },
  ),
});

type SignedPolicy = Awaited<ReturnType<typeof signPolicyState>>;

export interface PolicyChain {
  readonly principalId: string;
  /** The encapsulation key pair of the head's key epoch. */
  readonly principalKeyPair: ReturnType<typeof generateKemSeedAndKeyPair>;
  /** The key pair each state was signed under, by index; a shrink rotates it. */
  readonly keyPairs: readonly ReturnType<typeof generateKemSeedAndKeyPair>[];
  readonly signer: Awaited<ReturnType<typeof createPolicySigner>>;
  readonly states: readonly SignedPolicy[];
}

let policySignerPromise:
  | Promise<Awaited<ReturnType<typeof createPolicySigner>>>
  | undefined;

export async function buildPolicyChain(
  plan: PolicyChainPlan,
  label: string,
): Promise<PolicyChain> {
  policySignerPromise ??= createPolicySigner("policy-admin");
  const signer = await policySignerPromise;
  const principalId = `group-${label}`;
  let principalKeyPair = generateKemSeedAndKeyPair();
  const memberIds = (users: readonly number[]) => [
    { userId: signer.userId },
    ...users.map((user) => ({ userId: `member-${user}` })),
  ];
  let members = [...new Set(plan.initial)];
  const first = await signPolicyState({
    principalId,
    principalKeyPair,
    version: 1,
    prevStateHash: null,
    members: memberIds(members),
    signer,
  });
  const states: SignedPolicy[] = [first];
  const keyPairs = [principalKeyPair];
  for (const step of plan.steps) {
    const previous = states.at(-1);
    if (!previous) throw new Error("chain is never empty");
    if (step.kind === "add") {
      if (members.includes(step.user)) continue;
      members = [...members, step.user];
      states.push(
        await signPolicyState({
          principalId,
          principalKeyPair,
          version: previous.state.version + 1,
          prevStateHash: previous.state.stateHash,
          keyEpoch: previous.state.keyEpoch,
          members: memberIds(members),
          signer,
        }),
      );
      keyPairs.push(principalKeyPair);
    } else {
      if (!members.includes(step.user)) continue;
      members = members.filter((user) => user !== step.user);
      // A shrink rotates the key epoch, and a new epoch carries a new key.
      principalKeyPair = generateKemSeedAndKeyPair();
      states.push(
        await signPolicyState({
          principalId,
          principalKeyPair,
          version: previous.state.version + 1,
          prevStateHash: previous.state.stateHash,
          keyEpoch: previous.state.keyEpoch + 1,
          members: memberIds(members),
          signer,
        }),
      );
      keyPairs.push(principalKeyPair);
    }
  }
  return { principalId, principalKeyPair, keyPairs, signer, states };
}

export function policyBundleAt(chain: PolicyChain, index: number) {
  const current = chain.states[index];
  if (!current) throw new Error("policy chain index out of range");
  return createBundle({
    current,
    previous: chain.states.slice(0, index).map((state) => state.entry),
  });
}

export function policyCheckpointOf(state: SignedPolicy) {
  return {
    principalType: "group" as const,
    principalId: state.state.principalId,
    version: state.state.version,
    stateHash: state.state.stateHash,
  };
}
