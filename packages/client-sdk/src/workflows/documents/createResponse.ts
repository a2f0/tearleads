import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
} from "@tearleads/validators/response";
import { acknowledgeDocumentMutation } from "../../data/documents/shared/mutationAcknowledgement";
import { assertDocumentWriterProjectionConsistent } from "../../data/documents/shared/projection";
import { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
import type {
  CreateRemoteDocumentResult,
  DocumentCreateApi,
  DocumentCreateAuthor,
  MaterializedDocumentCreatePlan,
  ProjectionVerificationOptions,
} from "../../data/documents/shared/types";
import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { nullOnProjectionVerificationCancellation } from "../../data/keyingProjectionVerification/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { adoptExistingRemoteDocument } from "./createAdoption";
import { documentWriterProjectionFromCreateResponse } from "./createProjection";

/** A matched acknowledgement remains committed if authorization evidence races. */
export async function acknowledgeRemoteDocumentCreate(
  input: {
    readonly apiClient: DocumentCreateApi;
    readonly author: DocumentCreateAuthor;
    readonly containerProjection: ContainerWriterProjectionResponse;
    readonly execSql: ExecSql;
    readonly materializedPlan: MaterializedDocumentCreatePlan;
    readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
    readonly response: DocumentCreateResponse;
    readonly targetSecretKey: Uint8Array;
  } & ProjectionVerificationOptions,
): Promise<CreateRemoteDocumentResult | null> {
  const { materializedPlan, response } = input;
  const persistedState = persistedDocumentCreateStateFromResponse(
    materializedPlan.plan,
    response,
  );
  await acknowledgeDocumentMutation({
    execSql: input.execSql,
    plan: materializedPlan.plan,
    stillCurrent: input.stillCurrent,
  });
  if (input.stillCurrent?.() === false) return null;
  const writerProjection = documentWriterProjectionFromCreateResponse(input);
  try {
    const targets = await nullOnProjectionVerificationCancellation(() =>
      assertDocumentWriterProjectionConsistent(writerProjection, input),
    );
    if (!targets || input.stillCurrent?.() === false) return null;
  } catch (error) {
    if (!(error instanceof ProjectionDependencyUnavailableError)) throw error;
    // A principal pin can advance while POST is in flight. Recover the already
    // committed document from fresh evidence, without submitting another create.
    // The adoption path still verifies its author, scope, chain and key binding.
    return nullOnProjectionVerificationCancellation(() =>
      adoptExistingRemoteDocument({
        ...input,
        documentId: response.id,
        expectedContainerId: input.containerProjection.containerId,
        expectedOrganizationId: input.containerProjection.organizationId,
        expectedSignerUserId: input.author.signerUserId,
      }),
    );
  }
  input.apiClient.primeDocumentWriterProjection(response.id, writerProjection);
  return {
    contentKey: materializedPlan.contentKey,
    documentId: response.id,
    persistedState,
    plan: materializedPlan.plan,
    response,
    writerProjection,
  };
}
