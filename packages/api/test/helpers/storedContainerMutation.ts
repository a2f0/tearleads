import { db } from "@tearleads/api-shared/postgres";
import type {
  ContainerKekKeyring,
  ContainerKekRecipientTarget,
  ContainerKeyEpoch,
  ContainerKeyWrap,
} from "@tearleads/crypto";
import type { AccessManifestBundleWire } from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  type ContainerReciteResponse,
  isContainerMutationResponse,
  isContainerReciteResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import { getAccessManifestBundle } from "../../src/access/read/accessManifestStore";
import {
  getContainerKeyEpochById,
  getContainerKeyEpochKeyring,
  listContainerKeyWraps,
  toContainerKeyEpoch,
  toContainerKeyWrap,
} from "../../src/access/read/containerKekStore";

/**
 * The committed KEK state a mutation acknowledgement names by hash, read back
 * from the store. Shaped like `VerifiedContainerKekState` so tests can cite it.
 */
type ContainerMutationKekAcknowledgement =
  ContainerMutationResponse["containerKek"];

export interface StoredContainerKek
  extends ContainerMutationKekAcknowledgement {
  readonly accessManifestHash: string;
  readonly containerId: string;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly keyring: ContainerKekKeyring | null;
  readonly recipientTargets: readonly ContainerKekRecipientTarget[];
  readonly wraps: readonly ContainerKeyWrap[];
}

export type StoredContainerRecitation<T extends ContainerReciteResponse> = T & {
  readonly accessManifest: AccessManifestBundleWire;
};

export type StoredContainerMutation<
  T extends ContainerMutationResponse = ContainerMutationResponse,
> = Omit<T, "containerKek"> & {
  readonly accessManifest: AccessManifestBundleWire;
  readonly containerKek: StoredContainerKek;
};

/** The signed bundle an acknowledgement names, read back from the store. */
export async function storedContainerManifestBundle(
  manifestHash: string,
): Promise<AccessManifestBundleWire> {
  const bundle = await getAccessManifestBundle(manifestHash, db);
  invariant(bundle, `expected stored container manifest ${manifestHash}`);
  return bundle as unknown as AccessManifestBundleWire;
}

/** Adds the stored bundle a recitation acknowledgement names by hash. */
export async function withStoredContainerManifest(
  value: unknown,
): Promise<StoredContainerRecitation<ContainerReciteResponse>> {
  if (!isContainerReciteResponse(value))
    throw new Error("Expected a container recitation acknowledgement");
  const response = value;
  return {
    ...response,
    accessManifest: await storedContainerManifestBundle(
      response.manifestHead.manifestHash,
    ),
  };
}

/**
 * Adds the stored bundle and KEK state a mutation acknowledgement names by
 * hash, so tests can chain the next mutation from what the server committed.
 */
export async function withStoredContainerMutation(
  value: unknown,
): Promise<StoredContainerMutation> {
  if (!isContainerMutationResponse(value))
    throw new Error("Expected a container mutation acknowledgement");
  const response = value;
  const { containerKeyEpochId } = response.containerKek;
  const storedEpoch = await getContainerKeyEpochById(containerKeyEpochId, db);
  invariant(storedEpoch, `expected stored key epoch ${containerKeyEpochId}`);
  const wraps = (await listContainerKeyWraps(containerKeyEpochId, db)).map(
    toContainerKeyWrap,
  );
  return {
    ...response,
    accessManifest: await storedContainerManifestBundle(
      response.manifestHead.manifestHash,
    ),
    containerKek: {
      ...response.containerKek,
      accessManifestHash: response.manifestHead.manifestHash,
      containerId: response.containerId,
      keyEpoch: toContainerKeyEpoch(storedEpoch),
      keyring: await getContainerKeyEpochKeyring(containerKeyEpochId, db),
      recipientTargets: wraps.map((wrap) => ({
        recipientId: wrap.recipientId,
        recipientKeyEpochId: wrap.recipientKeyEpochId,
        recipientKeyFingerprint: wrap.recipientKeyFingerprint,
        recipientKind: wrap.recipientKind,
      })),
      wraps,
    },
  };
}
