import fc from "fast-check";
import { generateKemSeedAndKeyPair } from "../encapsulation/generateKeyPair";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { fixtureContainerKekMaterialId } from "./containerKekMaterial.testFixtures";
import {
  type ContainerAccessEventBody,
  type ContainerAccessManifestState,
  type ContainerDirectGrant,
  type ContainerUserRecipientKey,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  type VerifiedContainerAccessManifest,
  type VerifiedContainerKekState,
  verifyContainerAccessManifest,
  verifyContainerKekState,
} from "./index";
import {
  createBundle,
  createPolicySigner,
  signPolicyState,
} from "./principalPolicyTestFixtures";
import {
  createContainerKeyEpochFixture,
  createContainerKeyWrap,
  createVerifiedContainerAccessEvent,
  fixtureHash,
} from "./testFixtures";

/**
 * Generators for the keying property suite (#2192 Gate F2). fast-check draws
 * small *plans*; the async builders below sign and derive the real
 * manifests, policies, and key states those plans describe, so every
 * property runs the production verifiers over signed inputs. Signing keys
 * come from a fixed pool because ML-DSA-87 key generation and signing
 * dominate the cost of a run.
 */

export const ORGANIZATION_ID = "organization-property";
const ACCESS_LEVELS = ["read", "write", "admin"] as const;
type AccessLevel = (typeof ACCESS_LEVELS)[number];

interface PoolSigner {
  readonly userId: string;
  readonly signing: ReturnType<typeof generateSigningSeedAndKeyPair>;
}

const POOL_SIZE = 4;
let poolPromise: Promise<readonly PoolSigner[]> | undefined;

/** The creator is always `pool[0]`; the others are grantees or forgers. */
export function signerPool(): Promise<readonly PoolSigner[]> {
  poolPromise ??= Promise.resolve(
    Array.from({ length: POOL_SIZE }, (_, index) => ({
      userId: `user-${index}`,
      signing: generateSigningSeedAndKeyPair(),
    })),
  );
  return poolPromise;
}

type ContainerStepPlan =
  | {
      readonly kind: "grant";
      readonly user: number;
      readonly level: AccessLevel;
    }
  | { readonly kind: "revoke"; readonly user: number }
  | { readonly kind: "rekey" };

interface ContainerChainPlan {
  /** Grants at creation for pool users 1..3, by index; the creator is admin. */
  readonly initial: readonly {
    readonly user: number;
    readonly level: AccessLevel;
  }[];
  readonly steps: readonly ContainerStepPlan[];
}

const granteeArb = fc.integer({ min: 1, max: POOL_SIZE - 1 });
const levelArb = fc.constantFrom(...ACCESS_LEVELS);

export const containerChainPlanArb: fc.Arbitrary<ContainerChainPlan> =
  fc.record({
    initial: fc.uniqueArray(fc.record({ user: granteeArb, level: levelArb }), {
      maxLength: POOL_SIZE - 1,
      selector: (grant) => grant.user,
    }),
    steps: fc.array(
      fc.oneof(
        fc.record({
          kind: fc.constant("grant" as const),
          user: granteeArb,
          level: levelArb,
        }),
        fc.record({ kind: fc.constant("revoke" as const), user: granteeArb }),
        fc.record({ kind: fc.constant("rekey" as const) }),
      ),
      { maxLength: 3 },
    ),
  });

export function sortedGrants(
  grants: readonly ContainerDirectGrant[],
): ContainerDirectGrant[] {
  return [...grants].sort((left, right) =>
    `${left.subjectType}:${left.subjectId}`.localeCompare(
      `${right.subjectType}:${right.subjectId}`,
    ),
  );
}

let keyEpochCounter = 0;
/** Key epoch ids commit to key material; the fixture id has that shape. */
async function freshKeyEpochId(containerId: string): Promise<string> {
  keyEpochCounter += 1;
  return fixtureContainerKekMaterialId(
    `${containerId}:key-epoch:${keyEpochCounter}`,
  );
}

interface ContainerChain {
  readonly containerId: string;
  readonly creator: PoolSigner;
  /** Every manifest in epoch order; the last is the head. */
  readonly manifests: readonly VerifiedContainerAccessManifest[];
}

/** A successor manifest derived from a signed event and the state change it makes. */
export async function containerSuccessor(input: {
  readonly body: ContainerAccessEventBody;
  readonly previous: VerifiedContainerAccessManifest;
  readonly signer: PoolSigner;
  readonly state: Partial<ContainerAccessManifestState>;
}): Promise<VerifiedContainerAccessManifest> {
  const event = await createVerifiedContainerAccessEvent({
    body: input.body,
    objectId: input.previous.state.containerId,
    organizationId: ORGANIZATION_ID,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer.signing,
    signerUserId: input.signer.userId,
  });
  const state: ContainerAccessManifestState = {
    ...input.previous.state,
    ...input.state,
    epoch: input.previous.state.epoch + 1,
    eventHash: event.eventHash,
    previousManifestHash: input.previous.manifestHash,
  };
  const manifest = await deriveContainerAccessManifest(state);
  // The production verifier is the honest twin of every generated step, and
  // its output carries the checkpoint evidence later properties rely on.
  const verified = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    previousManifest: input.previous,
    previousContainerPath: [input.previous],
  });
  if (!verified.ok) throw verified.error;
  return verified.value;
}

async function rotationBody(containerId: string): Promise<{
  readonly containerKeyEpochId: string;
  readonly keyringHash: string;
  readonly predecessorBridgeHash: string;
}> {
  const containerKeyEpochId = await freshKeyEpochId(containerId);
  return {
    containerKeyEpochId,
    keyringHash: await fixtureHash(
      `${containerId}:keyring:${containerKeyEpochId}`,
    ),
    predecessorBridgeHash: await fixtureHash(
      `${containerId}:bridge:${containerKeyEpochId}`,
    ),
  };
}

/** One planned step applied to the chain head; null when the plan step is a no-op. */
async function applyContainerStep(
  previous: VerifiedContainerAccessManifest,
  step: ContainerStepPlan,
  creator: PoolSigner,
  subjectId: string,
): Promise<VerifiedContainerAccessManifest | null> {
  const granted = previous.state.directGrants.some(
    (grant) => grant.subjectId === subjectId,
  );
  if (step.kind === "grant") {
    if (granted) return null;
    const grant: ContainerDirectGrant = {
      subjectType: "user",
      subjectId,
      accessLevel: step.level,
    };
    return containerSuccessor({
      body: {
        eventType: "container.grant",
        containerKeyEpochId: previous.state.containerKeyEpochId,
        grant,
        referencedPrincipalHead: null,
      },
      previous,
      signer: creator,
      state: {
        directGrants: sortedGrants([...previous.state.directGrants, grant]),
      },
    });
  }
  if (step.kind === "revoke") {
    if (!granted) return null;
    const rotation = await rotationBody(previous.state.containerId);
    return containerSuccessor({
      body: {
        eventType: "container.revoke",
        ...rotation,
        subjectId,
        subjectType: "user",
      },
      previous,
      signer: creator,
      state: {
        containerKeyEpochId: rotation.containerKeyEpochId,
        directGrants: previous.state.directGrants.filter(
          (grant) => grant.subjectId !== subjectId,
        ),
      },
    });
  }
  const rotation = await rotationBody(previous.state.containerId);
  return containerSuccessor({
    body: {
      eventType: "container.rekey",
      ...rotation,
      referencedPrincipalHeads: previous.state.referencedPrincipalHeads,
    },
    previous,
    signer: creator,
    state: { containerKeyEpochId: rotation.containerKeyEpochId },
  });
}

/** Materialize a plan: a signed create by the creator, then each step signed by the creator. */
export async function buildContainerChain(
  plan: ContainerChainPlan,
  label: string,
): Promise<ContainerChain> {
  const pool = await signerPool();
  const creator = pool[0];
  if (!creator) throw new Error("signer pool is never empty");
  const containerId = `container-${label}`;
  const { createContainerManifestFixture } = await import("./testFixtures");
  const initialGrants = sortedGrants([
    { subjectType: "user", subjectId: creator.userId, accessLevel: "admin" },
    ...plan.initial.map((grant) => ({
      subjectType: "user" as const,
      subjectId: pool[grant.user]?.userId ?? "",
      accessLevel: grant.level,
    })),
  ]);
  const created = await createContainerManifestFixture({
    containerId,
    containerKeyEpochId: await freshKeyEpochId(containerId),
    directGrants: initialGrants,
    organizationId: ORGANIZATION_ID,
    signer: creator.signing,
    signerUserId: creator.userId,
  });
  const first = await verifyContainerAccessManifest({
    manifest: created.manifest,
    expectedManifestHash: created.manifestHash,
    event: created.event,
  });
  if (!first.ok) throw first.error;
  const manifests: VerifiedContainerAccessManifest[] = [first.value];
  for (const step of plan.steps) {
    const previous = manifests.at(-1);
    if (!previous) throw new Error("chain is never empty");
    const subjectId =
      step.kind === "rekey" ? "" : (pool[step.user]?.userId ?? "");
    const next = await applyContainerStep(previous, step, creator, subjectId);
    if (next) manifests.push(next);
  }
  return { containerId, creator, manifests };
}

export function checkpointOf(manifest: VerifiedContainerAccessManifest) {
  return {
    objectKind: "container" as const,
    objectId: manifest.state.containerId,
    organizationId: manifest.state.organizationId,
    epoch: manifest.state.epoch,
    manifestHash: manifest.manifestHash,
  };
}

/**
 * A KEK state wrapping the epoch key to exactly the manifest's directly
 * granted users, which is the recipient set the verifier derives.
 */
export async function buildKekState(
  manifest: VerifiedContainerAccessManifest,
): Promise<{
  readonly keyEpoch: Awaited<ReturnType<typeof createContainerKeyEpochFixture>>;
  readonly recipients: readonly ContainerUserRecipientKey[];
  readonly wraps: Awaited<ReturnType<typeof createContainerKeyWrap>>[];
  readonly state: VerifiedContainerKekState;
}> {
  const keyEpoch = await createContainerKeyEpochFixture({ manifest });
  const recipientUserIds = manifest.state.directGrants
    .filter((grant) => grant.subjectType === "user")
    .map((grant) => grant.subjectId);
  const recipients: ContainerUserRecipientKey[] = await Promise.all(
    recipientUserIds.map(async (userId) => {
      const recipientKeyFingerprint = await fixtureHash(
        `${manifest.state.containerId}:${userId}:recipient-key`,
      );
      return {
        userId,
        recipientKeyEpochId: ["user", userId, 1, recipientKeyFingerprint].join(
          ":",
        ),
        recipientKeyFingerprint,
      };
    }),
  );
  const wraps = await Promise.all(
    recipients.map((recipient) =>
      createContainerKeyWrap({
        containerKeyEpochId: keyEpoch.id,
        recipientKind: "user",
        recipientId: recipient.userId,
        recipientKeyEpochId: recipient.recipientKeyEpochId,
        recipientKeyFingerprint: recipient.recipientKeyFingerprint,
        wrapManifestHash: manifest.manifestHash,
      }),
    ),
  );
  const result = await verifyContainerKekState({
    containerManifest: manifest,
    keyEpoch,
    userRecipientKeys: recipients,
    wraps,
  });
  if (!result.ok) throw result.error;
  return { keyEpoch, recipients, wraps, state: result.value };
}

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
