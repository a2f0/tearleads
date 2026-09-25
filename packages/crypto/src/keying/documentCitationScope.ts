import { assertContainerPathIntegrity } from "./containerParentAuthority";
import { throwVerification } from "./shared";
import type {
  DocumentAccessEventBody,
  VerifiedAccessEvent,
  VerifiedContainerAccessManifest,
  VerifiedDocumentLinkSetStateEvidence,
} from "./types";

type Path = readonly VerifiedContainerAccessManifest[];

/**
 * Historical readers reconstruct a path for every cited ancestor. Those
 * prefixes are evidence only when a scoped leaf's path actually contains them.
 * A writable path alone cannot license the rest of the citation set.
 */
export function assertDocumentCitationScope(input: {
  readonly dependencyManifestHashes?: readonly string[];
  readonly additionalDependencyHashes?: readonly string[];
  readonly label: string;
  readonly linkedContainerIds: readonly string[];
  readonly leafManifestHashes?: ReadonlySet<string>;
  readonly organizationId: string;
  readonly paths: readonly Path[];
  readonly targetPath?: Path | undefined;
}): void {
  for (const path of input.paths) {
    assertContainerPathIntegrity(path, input.label);
  }
  if (input.targetPath) {
    assertContainerPathIntegrity(input.targetPath, input.label);
  }
  const linkedIds = new Set(input.linkedContainerIds);
  const scopedPaths = input.paths.filter((path) => {
    const leaf = path.at(-1);
    return (
      leaf &&
      linkedIds.has(leaf.state.containerId) &&
      (!input.leafManifestHashes ||
        input.leafManifestHashes.has(leaf.manifestHash))
    );
  });
  const allowedHeads = [...scopedPaths.flat(), ...(input.targetPath ?? [])];
  if (
    allowedHeads.some(
      (head) => head.state.organizationId !== input.organizationId,
    )
  ) {
    throwVerification(
      "object_mismatch",
      `${input.label} authorizing path crosses organizations`,
    );
  }
  const allowedHashes = new Set(allowedHeads.map((head) => head.manifestHash));
  for (const path of input.paths) {
    if (
      path.length === 0 ||
      path.some((head) => !allowedHashes.has(head.manifestHash))
    ) {
      throwVerification(
        "object_mismatch",
        `${input.label} authorizing path is outside the document scope`,
      );
    }
  }
  const dependencies = new Set([
    ...allowedHashes,
    ...(input.additionalDependencyHashes ?? []),
  ]);
  if (input.dependencyManifestHashes?.some((hash) => !dependencies.has(hash))) {
    throwVerification(
      "object_mismatch",
      `${input.label} authorizing citation is outside the document scope`,
    );
  }
}

export function assertDocumentLinkSetCitationScope(input: {
  readonly authorizingContainerPaths: readonly Path[] | undefined;
  readonly body: DocumentAccessEventBody;
  readonly event: VerifiedAccessEvent;
  readonly previousManifest: VerifiedDocumentLinkSetStateEvidence | null;
  readonly targetContainerPath: Path | undefined;
}): void {
  const previousIds = input.previousManifest?.state.linkedContainerIds ?? [];
  assertDocumentCitationScope({
    dependencyManifestHashes: input.event.event.dependencyManifestHashes,
    label: input.body.eventType,
    linkedContainerIds:
      input.body.eventType === "document.unlink"
        ? previousIds.filter((id) => id !== input.body.containerId)
        : previousIds,
    organizationId: input.event.event.organizationId,
    paths: input.authorizingContainerPaths ?? [],
    targetPath: input.targetContainerPath,
  });
}
