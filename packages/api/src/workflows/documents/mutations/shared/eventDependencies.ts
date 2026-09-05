import type { VerifiedAccessEvent } from "@tearleads/crypto";
import type { ContainerManifestRef } from "@tearleads/validators/request";
import { uniqueSortedStrings } from "../../../../utils/array";
import { DocumentMutationError } from "../errors";

interface DocumentAccessDependencyRequest {
  readonly authorizingContainerPathRefs?:
    | readonly (readonly ContainerManifestRef[])[]
    | undefined;
  readonly targetContainerPathRefs?:
    | readonly ContainerManifestRef[]
    | undefined;
}

export function assertDocumentAccessEventDependenciesMatchRequest(
  request: DocumentAccessDependencyRequest,
  event: Pick<VerifiedAccessEvent["event"], "dependencyManifestHashes">,
): void {
  const expected = uniqueSortedStrings(
    [
      ...(request.targetContainerPathRefs ?? []),
      ...(request.authorizingContainerPathRefs ?? []).flat(),
    ].map((ref) => ref.manifestHash),
  );
  const actual = [...event.dependencyManifestHashes].sort();
  if (
    expected.length !== actual.length ||
    expected.some((hash, index) => hash !== actual[index])
  ) {
    throw new DocumentMutationError(
      "Document access event dependency hashes do not match supplied manifests",
      409,
    );
  }
}
