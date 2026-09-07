import type { RootIdentity } from "@tearleads/client-sdk";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../components/mini-app/MiniAppTable";
import { compactRootIdentifier, formatRootTimestamp } from "./rootDisplay";

const IDENTITY_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: "Signing Key", id: "signing-key" },
  { header: "User ID", id: "user-id" },
  { header: "Registered", id: "registered", width: "10rem" },
  { header: "Last Active", id: "last-active", width: "10rem" },
  { header: "Root", id: "root", width: "4rem" },
];

function IdentityRow({
  identity,
  onSelect,
}: {
  identity: RootIdentity;
  onSelect: (userId: string) => void;
}) {
  return (
    <MiniAppTableRow
      interactive
      onActivate={() => onSelect(identity.userId)}
      tabIndex={0}
    >
      <MiniAppTableCell>
        <MiniAppTableText title={identity.signingKeyFingerprint}>
          {compactRootIdentifier(identity.signingKeyFingerprint)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={identity.userId}>
          {compactRootIdentifier(identity.userId)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText truncate={false}>
          {formatRootTimestamp(identity.createdAt)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText truncate={false}>
          {formatRootTimestamp(identity.lastActiveAt)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText muted={!identity.isRoot}>
          {identity.isRoot ? "Yes" : "No"}
        </MiniAppTableText>
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

export function IdentitiesTable({
  identities,
  loading,
  onSelect,
}: {
  identities: ReadonlyArray<RootIdentity>;
  loading: boolean;
  onSelect: (userId: string) => void;
}) {
  return (
    <MiniAppTableFrame>
      <MiniAppTable aria-label="Identities" columns={IDENTITY_COLUMNS}>
        {identities.length === 0 ? (
          <MiniAppTableEmptyRow colSpan={IDENTITY_COLUMNS.length}>
            {loading ? "Loading identities..." : "No identities found."}
          </MiniAppTableEmptyRow>
        ) : (
          identities.map((identity) => (
            <IdentityRow
              identity={identity}
              key={identity.userId}
              onSelect={onSelect}
            />
          ))
        )}
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}
