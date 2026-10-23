import type { RootOrganizationIdentity } from "@tearleads/client-sdk";
import {
  MiniAppTableCell,
  MiniAppTableText,
} from "../../../components/mini-app/MiniAppTable";
import { formatRootTimestamp } from "../identities/rootDisplay";

/** Seat and sync-pause cells shared by both roster tables. */
export function RosterSeatAndSyncCells({
  roster,
}: {
  roster: RootOrganizationIdentity["roster"];
}) {
  return (
    <>
      <MiniAppTableCell>
        <MiniAppTableText muted={!roster.holdsSeat}>
          {roster.holdsSeat ? "Yes" : "No"}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText muted={roster.syncPausedAt === null} truncate={false}>
          {roster.syncPausedAt === null
            ? "Not paused"
            : `Paused ${formatRootTimestamp(roster.syncPausedAt)}`}
        </MiniAppTableText>
      </MiniAppTableCell>
    </>
  );
}
