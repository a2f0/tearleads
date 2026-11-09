import type {
  AccessEvent,
  ContainerAccessManifestState,
} from "@tearleads/crypto";
import { deriveOrganizationMetadataContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import type { ExecSql, ExecSqlClientLike } from "../../data/sqlite/sqlSchema";
import {
  type DestinationRole,
  rememberDestinationRole,
} from "../container-contents/remoteHydration/destination/destinationRoleCache";

/** A container the provisioning request created, as this client signed it. */
export interface ProvisionedContainerSeed {
  /** The manifest head the provisioning response acknowledged, if any. */
  readonly acknowledgedManifestHash: string | undefined;
  /** The signed epoch-1 create plan, as far as roles read it. */
  readonly plan: {
    readonly containerId: string;
    readonly event: Pick<AccessEvent, "signerKeyFingerprint" | "signerUserId">;
    readonly manifestHash: string;
    readonly state: Pick<
      ContainerAccessManifestState,
      | "containerId"
      | "epoch"
      | "metadataDocumentId"
      | "organizationId"
      | "parentContainerId"
      | "systemSlot"
    >;
  };
}

/**
 * Remembers the destination roles of the containers a provisioning request
 * created, so the device's first hydration of them needs no writer-projection
 * read to learn what it signed. It is bound to the provisioning scope: the
 * database the bootstrap committed to and the identity that signed it. Failure
 * leaves the online path.
 */
export type ProvisionedContainerSeeder = (input: {
  readonly containers: readonly ProvisionedContainerSeed[];
  /** The database client the provisioning bootstrap committed to. */
  readonly database: ExecSqlClientLike;
  /** Whether the identity that provisioned is still the active one. */
  readonly isCurrent: () => boolean;
  /** The root the response acknowledged; it becomes the session root. */
  readonly rootContainerId: string;
  /** The user the response acknowledged, who signed every create. */
  readonly userId: string;
}) => Promise<void>;

/** The runtime seams seeding reads; none of them writes durable state. */
interface ProvisionedContainerSeedRuntime {
  /** The runtime executor, only while `database` is its ready database. */
  readonly execSqlFor: (database: ExecSqlClientLike) => ExecSql | null;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly signingFingerprint: () => string | null;
}

/** The server acknowledged exactly the epoch-1 head this identity signed. */
function acknowledgedSignedCreate(
  seed: ProvisionedContainerSeed,
  userId: string,
  signingFingerprint: string,
): boolean {
  const { plan } = seed;
  return (
    seed.acknowledgedManifestHash === plan.manifestHash &&
    plan.state.containerId === plan.containerId &&
    plan.state.epoch === 1 &&
    plan.event.signerUserId === userId &&
    plan.event.signerKeyFingerprint === signingFingerprint
  );
}

/**
 * The role fresh destination verification would derive from the signed path
 * (see `destinationRoleFromPath`): the session root, the organization metadata
 * root (a one-manifest path), or a system child of the session root (a
 * two-manifest path). Anything else is left to verification.
 */
function provisionedDestinationRole(input: {
  readonly metadataSlot: string;
  readonly root: ProvisionedContainerSeed | undefined;
  readonly seed: ProvisionedContainerSeed;
}): DestinationRole | null {
  const { root, seed } = input;
  const { state } = seed.plan;
  let pathRoot: ProvisionedContainerSeed | undefined;
  if (state.parentContainerId === null) {
    pathRoot =
      state.systemSlot === input.metadataSlot ||
      (state.systemSlot === null && seed === root)
        ? seed
        : undefined;
  } else if (
    state.systemSlot !== null &&
    state.systemSlot !== input.metadataSlot &&
    state.parentContainerId === root?.plan.containerId
  ) {
    pathRoot = root;
  }
  if (!pathRoot) return null;
  return {
    createSignerUserId: seed.plan.event.signerUserId,
    metadataDocumentId: state.metadataDocumentId,
    parentId: state.parentContainerId,
    rootContainerId: pathRoot.plan.containerId,
    rootCreateManifestHash: pathRoot.plan.manifestHash,
    rootMetadataDocumentId: pathRoot.plan.state.metadataDocumentId,
    systemSlot: state.systemSlot,
  };
}

async function seedInProvisioningScope(
  runtime: ProvisionedContainerSeedRuntime,
  input: Parameters<ProvisionedContainerSeeder>[0],
): Promise<void> {
  // Captured synchronously, before the first await.
  const execSql = runtime.execSqlFor(input.database);
  const signingFingerprint = runtime.signingFingerprint();
  const scopeCurrent = () =>
    execSql !== null &&
    input.isCurrent() &&
    runtime.execSqlFor(input.database) === execSql &&
    runtime.signingFingerprint() === signingFingerprint;
  if (!execSql || !signingFingerprint || !scopeCurrent()) return;
  const acknowledged = input.containers.filter((seed) =>
    acknowledgedSignedCreate(seed, input.userId, signingFingerprint),
  );
  // #2266: only the acknowledged root this user created may become the
  // reconciliation target for pre-login local roots.
  const root = acknowledged.find(
    ({ plan }) =>
      plan.containerId === input.rootContainerId &&
      plan.state.parentContainerId === null &&
      plan.state.systemSlot === null,
  );
  const organizationIds = new Set(
    acknowledged.map(({ plan }) => plan.state.organizationId),
  );
  const [organizationId] = organizationIds;
  if (!organizationId || organizationIds.size !== 1) return;
  const metadataSlot = await deriveOrganizationMetadataContainerSystemSlot({
    organizationId,
  });
  if (!scopeCurrent()) return;
  for (const seed of acknowledged) {
    const role = provisionedDestinationRole({ metadataSlot, root, seed });
    if (!role) continue;
    rememberDestinationRole(
      execSql,
      { id: seed.plan.containerId, organizationId },
      role,
    );
  }
}

/**
 * Binds seeding to the exact provisioning scope, captured before any await:
 * the bootstrap's database and runtime executor (the key the role cache uses)
 * and the identity whose key signed every create. A switched identity or
 * database seeds nothing. Seeded roles hold only the immutable signed fields
 * the cache admits; reuse still rechecks the session-root creator.
 */
export function createProvisionedContainerSeeder(
  runtime: ProvisionedContainerSeedRuntime,
): ProvisionedContainerSeeder {
  return async (input) => {
    try {
      await seedInProvisioningScope(runtime, input);
    } catch (error) {
      runtime.logError(
        "Provisioned container roles were not seeded; hydration verifies them online",
        error,
      );
    }
  };
}
