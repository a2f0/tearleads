import { grantDocumentAccess } from "../../src/access/documentAccess";

export function grantDocumentWriteAccessToUser(
  documentId: string,
  userId: string,
): Promise<number> {
  return grantDocumentAccess({
    documentId,
    subjectType: "user",
    subjectId: userId,
    accessLevel: "write",
  });
}
