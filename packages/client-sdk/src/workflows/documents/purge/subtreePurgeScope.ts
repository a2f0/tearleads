import { isPlainObject } from "@tearleads/validators/isPlainObject";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readManifestContainerId } from "../../../data/documents/shared/readers";

/** The selected purge root and the parent the user selected it under. */
export interface SubtreePurgeRoot {
  readonly id: string;
  readonly parentId: string | null;
}

function readSignedParentContainerId(
  bundle: AccessManifestBundleWireResponse,
): unknown {
  return isPlainObject(bundle.state)
    ? Reflect.get(bundle.state, "parentContainerId")
    : undefined;
}

/** Check the exact verified path that the destructive request will cite. */
export function assertSubtreePurgePath(
  path: readonly AccessManifestBundleWireResponse[],
  root: SubtreePurgeRoot | undefined,
): void {
  if (root === undefined) return;
  const rootBundle = path.find(
    (bundle) => readManifestContainerId(bundle) === root.id,
  );
  // A valid move out of the selected subtree, or a settled restore of the
  // selected root itself, is ordinary concurrent work.
  if (!rootBundle || readSignedParentContainerId(rootBundle) !== root.parentId)
    throw new Error(
      "Document placement is outside the requested purge subtree",
    );
}
