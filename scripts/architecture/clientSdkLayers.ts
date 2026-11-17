import type { SubsystemLayers } from "./subsystemTypes";

/**
 * The client SDK subsystem layers (issue #2953), lowest first. A production
 * file may import at runtime only from a subsystem ranked below its own, so a
 * subsystem may not depend on one later in its own layer either. The order
 * follows the planned registry splits (trusted identity, sync primitives,
 * document projection contracts, facades) so that each split only removes
 * baseline entries.
 */
export const clientSdkLayers: SubsystemLayers = [
  [
    "SDK Shared Utilities",
    "SQLite Runtime",
    "Sync Coordination",
    "Security Incident Detection",
  ],
  [
    "Identity & Session",
    "Principal Policy Contracts",
    "Keying Verification",
    "Principal Policy (client)",
  ],
  [
    "Document Projection Contracts",
    "Container Data",
    "Client Blob Storage",
    "Document Store & Sync",
    "Container Contents",
  ],
  ["Organization Read Models", "Client Registration", "Sync Engine"],
  [
    "Local Keyring",
    "Client Purchases",
    "Root Console Client",
    "SDK Runtime & Composition Root",
  ],
];
