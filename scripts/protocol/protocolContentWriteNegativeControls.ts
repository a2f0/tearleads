import type { NegativeControl } from "./protocolNegativeControlTypes";

const CONTENT_WRITE_MODULE = "formal/document-sync/ContentWriteAuthority.tla";
const CONTENT_WRITE_CONFIG = "formal/document-sync/ContentWriteAuthority.cfg";

export const CONTENT_WRITE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "content-write-unrefreshed-citations",
    module: CONTENT_WRITE_MODULE,
    config: CONTENT_WRITE_CONFIG,
    constants: { RefreshMissingCitations: "FALSE" },
    expect: { kind: "invariant", name: "HonestWritesRemainReadable" },
    why: "A write may cite a head committed after the reader fetched its projection; verify one fresh projection before refusing the frozen response.",
  },
  {
    id: "content-write-pinned-parent",
    module: CONTENT_WRITE_MODULE,
    config: CONTENT_WRITE_CONFIG,
    constants: { ReadPinnedParent: "TRUE" },
    expect: { kind: "invariant", name: "HonestWritesRemainReadable" },
    why: "Rebuilding from the original parent pin loses a later grant after the leaf advances (#2266).",
  },
  {
    id: "content-write-current-membership",
    module: CONTENT_WRITE_MODULE,
    config: CONTENT_WRITE_CONFIG,
    constants: { ReadCurrentMembership: "TRUE" },
    expect: { kind: "invariant", name: "HonestWritesRemainReadable" },
    why: "Current membership rejects a delayed write committed before the signer was removed (#2266).",
  },
  {
    id: "content-write-stale-submission",
    module: CONTENT_WRITE_MODULE,
    config: CONTENT_WRITE_CONFIG,
    constants: { RequireCurrentCitations: "FALSE" },
    expect: { kind: "invariant", name: "NewWritesUseCurrentAuthority" },
    why: "Without current path equality a removed writer submits a stale signed authorization (#2266).",
  },
  {
    id: "content-write-unauthorized-citation",
    module: CONTENT_WRITE_MODULE,
    config: CONTENT_WRITE_CONFIG,
    constants: { CheckWriteAuthority: "FALSE" },
    expect: { kind: "invariant", name: "CommittedWritesAreAuthorized" },
    why: "A write whose cited path no longer grants its signer write access must be refused at commit.",
  },
  {
    id: "content-write-reader-filtered-projection",
    module: CONTENT_WRITE_MODULE,
    config: CONTENT_WRITE_CONFIG,
    constants: { ServeEveryWriteDependency: "FALSE" },
    expect: { kind: "invariant", name: "CitedHeadsReachEveryReader" },
    why: "A projection filtered to the reader's own authorized paths omits the path a write through another link cites, so that reader can never verify it.",
  },
  {
    id: "content-write-delete-drops-cited-manifests",
    module: CONTENT_WRITE_MODULE,
    config: CONTENT_WRITE_CONFIG,
    constants: { RetainManifestsOnDelete: "FALSE" },
    expect: { kind: "invariant", name: "HonestWritesRemainReadable" },
    why: "Deleting an unlinked container together with its manifests leaves readers on the document's other links unable to verify writes made through it.",
  },
];
