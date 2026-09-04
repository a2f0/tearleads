import {
  KeyingVerificationError,
  type VerifiedAccessEvent,
  type VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readCanonicalRecord } from "../keyingCanonicalJson";
import { readRecordNullableString } from "./readers";

/**
 * A container manifest pins the parent manifest it was created or moved
 * under, and successors inherit that pin, so the pin says nothing about the
 * ancestor heads a later grant, revoke, or rekey was actually authorized
 * under. Those heads are in the event: every container event signs the
 * manifest hashes of the path it was committed against, and the API refuses
 * an event whose citations are not the current heads at commit time. So a
 * head's authorization path is rebuilt here from its citations, root to
 * parent, and the signer is checked against those heads rather than against
 * whatever path the server pairs with the manifest.
 *
 * A head must also not cite an older head of any ancestor than an earlier
 * signed statement already proved current, so an ancestor head one signed
 * statement established can never be rolled back for a later one.
 *
 * Not applied here: the principal-policy rule that a successor new to this
 * device must cite the authority's current head. The API today refuses any
 * mutation on a container whose pinned parent manifest is no longer the
 * parent's head, so no later child event could ever supersede a head that
 * rule rejected, and one ordinary sequence (share a child, then change its
 * parent, then sync a device that missed both) would lock that device out of
 * the child for good. That rule follows once descendants can re-cite their
 * ancestors.
 */

interface CitedAncestorResolutionInput {
  readonly bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>;
  readonly label: string;
  readonly verifiedByHash: ReadonlyMap<string, VerifiedContainerAccessManifest>;
  readonly verifyHistoryBundle: (
    bundle: AccessManifestBundleWireResponse,
    label: string,
  ) => Promise<VerifiedContainerAccessManifest>;
}

function bundleContainerId(
  bundle: AccessManifestBundleWireResponse,
  label: string,
): string | null {
  return readRecordNullableString(
    readCanonicalRecord(bundle.state, `${label} state`),
    "containerId",
    `${label} state`,
  );
}

function citedContainerId(
  input: CitedAncestorResolutionInput,
  manifestHash: string,
): string | null {
  const verified = input.verifiedByHash.get(manifestHash);
  if (verified) return verified.state.containerId;
  const bundle = input.bundlesByHash.get(manifestHash);
  return bundle ? bundleContainerId(bundle, input.label) : null;
}

function citedManifestHashForContainer(
  input: CitedAncestorResolutionInput,
  cited: readonly string[],
  containerId: string,
): string {
  const hashes = cited.filter(
    (manifestHash) => citedContainerId(input, manifestHash) === containerId,
  );
  const [manifestHash] = hashes;
  if (manifestHash === undefined) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} does not cite a served head of its parent container ${containerId}`,
    );
  }
  if (hashes.length > 1) {
    throw new KeyingVerificationError(
      "duplicate_entry",
      `${input.label} cites more than one head of container ${containerId}`,
    );
  }
  return manifestHash;
}

async function resolveCitedManifest(
  input: CitedAncestorResolutionInput,
  manifestHash: string,
  containerId: string,
): Promise<VerifiedContainerAccessManifest> {
  const verified = input.verifiedByHash.get(manifestHash);
  if (verified) return verified;
  const bundle = input.bundlesByHash.get(manifestHash);
  if (!bundle) {
    throw new KeyingVerificationError(
      "missing_dependency",
      `${input.label} cites a head of container ${containerId} that the projection does not serve`,
    );
  }
  return input.verifyHistoryBundle(
    bundle,
    `${input.label} cited ancestor ${containerId}`,
  );
}

/**
 * The ancestor path, root first, that a container event cites, ending at the
 * head of `parentContainerId`. Empty for a root container.
 */
export async function resolveCitedAncestorPath(
  input: CitedAncestorResolutionInput & {
    readonly event: VerifiedAccessEvent;
    readonly parentContainerId: string | null;
  },
): Promise<VerifiedContainerAccessManifest[]> {
  const cited = input.event.event.dependencyManifestHashes;
  const chain: VerifiedContainerAccessManifest[] = [];
  const seen = new Set<string>();
  let containerId = input.parentContainerId;
  while (containerId !== null) {
    if (seen.has(containerId)) {
      throw new KeyingVerificationError(
        "object_mismatch",
        `${input.label} cited ancestors form a cycle at ${containerId}`,
      );
    }
    seen.add(containerId);
    const ancestor = await resolveCitedManifest(
      input,
      citedManifestHashForContainer(input, cited, containerId),
      containerId,
    );
    chain.unshift(ancestor);
    containerId = ancestor.state.parentContainerId;
  }
  return chain;
}

function verifiedCitedHead(
  input: CitedAncestorResolutionInput,
  cited: readonly string[],
  containerId: string,
): VerifiedContainerAccessManifest | undefined {
  const manifestHash = cited.find(
    (candidate) => citedContainerId(input, candidate) === containerId,
  );
  return manifestHash === undefined
    ? undefined
    : input.verifiedByHash.get(manifestHash);
}

/**
 * A head must not cite an older head of any ancestor than an earlier signed
 * statement already proved current: the manifest before it cited that
 * ancestor, or a cited child of that ancestor was itself created or moved
 * under it. Ancestors a statement cannot be resolved for are skipped.
 */
export function assertCitedAncestorsDoNotRegress(
  input: CitedAncestorResolutionInput & {
    readonly citedAncestors: readonly VerifiedContainerAccessManifest[];
    readonly previousManifest: VerifiedContainerAccessManifest | null;
  },
): void {
  const previous = input.previousManifest;
  const previousCited = previous?.event.event.dependencyManifestHashes ?? [];
  input.citedAncestors.forEach((ancestor, index) => {
    const containerId = ancestor.state.containerId;
    // Statements that already established a head of this ancestor: what the
    // previous manifest cited for it, the previous manifest's own pin when
    // this is its parent, and what the cited child pins and cites.
    const citedChild = input.citedAncestors[index + 1] ?? previous;
    const floors = [
      verifiedCitedHead(input, previousCited, containerId),
      ...(citedChild
        ? [
            input.verifiedByHash.get(citedChild.state.parentManifestHash ?? ""),
            verifiedCitedHead(
              input,
              citedChild.event.event.dependencyManifestHashes,
              containerId,
            ),
          ]
        : []),
    ];
    for (const floor of floors) {
      if (
        floor &&
        floor.state.containerId === ancestor.state.containerId &&
        ancestor.state.epoch < floor.state.epoch
      ) {
        throw new KeyingVerificationError(
          "rollback",
          `${input.label} cites an older head of container ${ancestor.state.containerId} than an earlier signed statement already proved current`,
        );
      }
    }
  });
}
