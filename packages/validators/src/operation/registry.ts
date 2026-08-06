import { challengeOperation, verifyOperation } from "./auth";
import { documentSyncOperation } from "./documentSync";

export const protocolOperations = [
  challengeOperation,
  verifyOperation,
  documentSyncOperation,
] as const;
