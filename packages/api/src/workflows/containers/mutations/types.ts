import type {
  ApiDatabase,
  DatabaseTransaction,
} from "@symcrypt/api-shared/postgres";
import type {
  AccessEventType,
  VerifiedContainerAccessManifest,
} from "@symcrypt/crypto";
import type { ContainerMutationRequest } from "@symcrypt/validators/request";
import type { getCurrentAccessManifestHead } from "../../../access/read/accessManifestStore";
import type { ContainerWriterProjectionContext } from "../writerProjection/types";

export type { ApiDatabase };
// 503 covers transient failures bubbling up from the metadata-document write
// inside a container create (wrapped from DocumentMutationError).
export type ContainerMutationStatus = 400 | 403 | 404 | 409 | 503;

export interface MutateContainerInput {
  readonly expectedContainerId?: string;
  readonly expectedEventType: AccessEventType;
  readonly fingerprint: string;
  readonly request: ContainerMutationRequest;
  readonly userId: string;
}

export interface MutateContainerWithExecutorInput extends MutateContainerInput {
  readonly context?: ContainerMutationContext;
  readonly executor: DatabaseTransaction;
}

export type ContainerMutationHandlerInput = Omit<
  MutateContainerWithExecutorInput,
  "expectedEventType"
>;

export interface StoredContainerRow {
  readonly createdAt: Date;
  readonly depth: number;
  readonly id: string;
  readonly systemSlot: string | null;
  readonly organizationId: string;
  readonly parentId: string | null;
  readonly updatedAt: Date;
}

export type VerifiedContainerAccessState =
  VerifiedContainerAccessManifest["state"];

export type CurrentAccessManifestHead = Awaited<
  ReturnType<typeof getCurrentAccessManifestHead>
>;

export interface ContainerMutationContext {
  readonly executor: DatabaseTransaction;
  /**
   * Group grant additions, removals, and level changes are valid only while
   * the same transaction advances the matching signed group grant index.
   */
  readonly mutatingGroupPrincipalId?: string | undefined;
  readonly manifestHeadByContainerId: Map<string, CurrentAccessManifestHead>;
  /** Independently verified manifests created earlier in the same batch. */
  readonly verifiedManifestByHash: Map<string, VerifiedContainerAccessManifest>;
  // Shared only with hash/id-addressed projection loaders during this write
  // transaction. Current-by-container lookups can become stale after a mutation
  // and must never consume this context's cache.
  readonly writerProjectionContext: ContainerWriterProjectionContext;
}
