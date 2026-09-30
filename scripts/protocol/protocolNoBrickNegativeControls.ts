import type { NegativeControl } from "./protocolNegativeControls";

const NO_BRICK_MODULE = "formal/container-keying/NoBrickedDevice.tla";
const NO_BRICK_HONEST = "formal/container-keying/NoBrickedDevice.cfg";
const NO_BRICK_ADVERSARY =
  "formal/container-keying/NoBrickedDeviceAdversary.cfg";

export const NO_BRICK_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "no-brick-signer-revoked-at-current",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_HONEST,
    constants: { RefuseSignerRevokedAtCurrent: "TRUE" },
    expect: { kind: "invariant", name: "HonestServerNeverRefused" },
    why: "Requiring current membership rejects an honest late-delivered head signed before the group removed its signer (#2266).",
  },
  {
    id: "no-brick-stale-head-citation",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_HONEST,
    constants: { RefuseStaleHeadCitation: "TRUE" },
    expect: { kind: "liveness", name: "DeviceEventuallyCurrent" },
    why: "The withdrawn #2174 currency rule refuses an honest late-delivered head, so a device that already holds the dependent can never advance without another device's write.",
  },
  {
    id: "no-brick-stale-head-citation-refuses-honest-server",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_HONEST,
    constants: { RefuseStaleHeadCitation: "TRUE" },
    expect: { kind: "invariant", name: "HonestServerNeverRefused" },
    why: "The same rule, caught as a safety violation: the refused projection is the honest server's.",
  },
  {
    id: "no-brick-stale-chain-citation",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_HONEST,
    constants: { RefuseStaleChainCitation: "TRUE" },
    expect: { kind: "liveness", name: "DeviceEventuallyCurrent" },
    why: "The #2173 principal-policy currency rule refuses every chain entry above the checkpoint that cites an older authority head, so even a later honest successor cannot heal the device.",
  },
  {
    id: "no-brick-fork",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseFork: "FALSE" },
    expect: { kind: "action", name: "HeldChainNeverContradictsCheckpoint" },
    why: "Without the checkpoint chain rule a device accepts a same-epoch fork or a chain that does not extend what it already holds.",
  },
  {
    id: "no-brick-rollback",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseRollback: "FALSE" },
    expect: { kind: "action", name: "CheckpointsAreMonotone" },
    why: "Without the rollback rule a device accepts a head or authority below its own checkpoint.",
  },
  {
    id: "no-brick-citation-regression",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseCitationRegression: "FALSE" },
    expect: { kind: "action", name: "HeldCitationsNeverRegress" },
    why: "Without the lineage floor a forged head can cite an authority head older than the one its predecessor established.",
  },
  {
    id: "no-brick-signer-revoked-at-citation",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseSignerRevokedAtCitation: "FALSE" },
    expect: { kind: "invariant", name: "HeldSignerWasMemberAtCitation" },
    why: "Without authorization at the cited head a revoked member's forged head citing a post-revocation authority is accepted.",
  },
  {
    id: "no-brick-served-authority-rollback",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseServedAuthorityRollback: "FALSE" },
    expect: { kind: "invariant", name: "HeldAuthorityCoversHeldCitation" },
    why: "Without the served-ancestor rule a device accepts a current authority head older than the one the dependent head's signature proves exists.",
  },
];
