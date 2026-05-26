import type {
  AccessEventType,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { getCurrentAccessManifestHead } from "../../../access/read/accessManifestStore";
import type {
  ApiDatabase,
  DatabaseTransaction,
} from "../../../adapters/postgres";

export type { ApiDatabase };
export type ContainerMutationStatus = 400 | 403 | 404 | 409;

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
  readonly manifestHeadByContainerId: Map<string, CurrentAccessManifestHead>;
}
