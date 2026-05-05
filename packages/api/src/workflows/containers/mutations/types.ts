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
  readonly depth: number;
  readonly id: string;
  readonly organizationId: string;
  readonly parentId: string | null;
}

export type VerifiedContainerAccessState =
  VerifiedContainerAccessManifest["state"];

// Verified crypto brands are compile-time only. Request/projection JSON can only
// rehydrate public fields; callers still run the corresponding verifier or
// current-head check before trusting these values.
export type UnbrandedVerified<T> = {
  readonly [K in keyof T as K extends symbol ? never : K]: T[K];
};

export type CurrentAccessManifestHead = Awaited<
  ReturnType<typeof getCurrentAccessManifestHead>
>;

export interface ContainerMutationContext {
  readonly executor: DatabaseTransaction;
  readonly manifestHeadByContainerId: Map<string, CurrentAccessManifestHead>;
}
