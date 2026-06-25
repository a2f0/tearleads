export interface AccountPurgeInput {
  readonly limit?: number | undefined;
  readonly now?: Date | undefined;
}

export interface MultipartStageObjectCleanup {
  readonly state: "complete" | "pending";
  readonly storageKey: string;
  readonly uploadId: string;
}

export interface PurgedAccountSummary {
  readonly organizationId: string;
  readonly userId: string;
  readonly deletedBlobObjectKeys: string[];
  readonly multipartStageObjects: MultipartStageObjectCleanup[];
}

export interface AccountPurgeResult {
  readonly purgedAccounts: PurgedAccountSummary[];
}

export interface OrganizationPurgeScope {
  readonly blobIds: string[];
  readonly containerIds: string[];
  readonly documentIds: string[];
  readonly eventHashes: string[];
  readonly groupIds: string[];
  readonly manifestHashes: string[];
  readonly updateIds: string[];
}
