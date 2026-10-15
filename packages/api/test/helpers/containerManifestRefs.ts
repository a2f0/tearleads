import type {
  AccessManifestBundleWire,
  ContainerManifestRef,
} from "@tearleads/validators/request";

/** Cite a stored container manifest the way a mutation request does. */
export function containerManifestRef(
  bundle: AccessManifestBundleWire,
): ContainerManifestRef {
  const containerId = Reflect.get(bundle.state, "containerId");
  if (typeof containerId !== "string" || containerId.length === 0) {
    throw new Error("Container manifest bundle is missing a container id");
  }
  return { containerId, manifestHash: bundle.manifestHash };
}

export function containerManifestRefs(
  bundles: readonly AccessManifestBundleWire[],
): ContainerManifestRef[] {
  return bundles.map(containerManifestRef);
}
