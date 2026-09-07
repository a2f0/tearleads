import type {
  RootIdentity,
  RootIdentityOrganization,
  RootIdentitySession,
} from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppInfoHeading,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppKeyValueTable,
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../components/mini-app/MiniAppTable";
import { compactRootIdentifier, formatRootTimestamp } from "./rootDisplay";
import { useRootIdentityDetail } from "./useRootIdentityDetail";

const SESSION_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: "Last Active", id: "last-active", width: "10rem" },
  { header: "Last IP", id: "last-ip", width: "9rem" },
  { header: "IPs", id: "ips" },
  { header: "Created", id: "created", width: "10rem" },
  { header: "Signing Key", id: "signing-key" },
];

const ORGANIZATION_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: "Organization", id: "name" },
  { header: "Roster", id: "roster", width: "6rem" },
  { header: "Billing", id: "billing", width: "7rem" },
  { header: "Trial Ends", id: "trial-ends", width: "10rem" },
  { header: "Period Ends", id: "period-ends", width: "10rem" },
  { header: "Seats", id: "seats", width: "4rem" },
];

function CopyableValue({ label, value }: { label: string; value: string }) {
  return (
    <span className="root-console-detail-value">
      <span className="root-console-detail-text" title={value}>
        {compactRootIdentifier(value)}
      </span>
      <MiniAppClipboardButton label={`Copy ${label}`} value={value} />
    </span>
  );
}

function IdentitySummary({ identity }: { identity: RootIdentity }) {
  return (
    <MiniAppKeyValueTable aria-label="Identity">
      <tbody>
        <MiniAppInfoRow label="User ID">
          <CopyableValue label="user ID" value={identity.userId} />
        </MiniAppInfoRow>
        <MiniAppInfoRow label="Signing Key">
          <CopyableValue
            label="signing key fingerprint"
            value={identity.signingKeyFingerprint}
          />
        </MiniAppInfoRow>
        <MiniAppInfoRow label="Default Organization">
          <CopyableValue
            label="default organization ID"
            value={identity.defaultOrganizationId}
          />
        </MiniAppInfoRow>
        <MiniAppInfoRow label="Registered">
          {formatRootTimestamp(identity.createdAt)}
        </MiniAppInfoRow>
        <MiniAppInfoRow label="Last Active">
          {formatRootTimestamp(identity.lastActiveAt)}
        </MiniAppInfoRow>
        <MiniAppInfoRow label="Registration IP">
          {identity.registrationSourceIpAddress ?? "Unknown"}
        </MiniAppInfoRow>
        <MiniAppInfoRow label="Root">
          {identity.isRoot ? "Yes" : "No"}
        </MiniAppInfoRow>
      </tbody>
    </MiniAppKeyValueTable>
  );
}

function SessionsTable({
  sessions,
}: {
  sessions: ReadonlyArray<RootIdentitySession>;
}) {
  return (
    <MiniAppTableFrame>
      <MiniAppTable aria-label="Live sessions" columns={SESSION_COLUMNS}>
        <tbody>
          {sessions.length === 0 ? (
            <MiniAppTableEmptyRow colSpan={SESSION_COLUMNS.length}>
              No live sessions.
            </MiniAppTableEmptyRow>
          ) : (
            sessions.map((session) => (
              <MiniAppTableRow key={session.id}>
                <MiniAppTableCell>
                  <MiniAppTableText truncate={false}>
                    {formatRootTimestamp(session.lastActiveAt)}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText>
                    {session.lastActiveIp ?? "None"}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText title={session.ipAddresses.join(", ")}>
                    {session.ipAddresses.length === 0
                      ? "None"
                      : session.ipAddresses.join(", ")}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText truncate={false}>
                    {formatRootTimestamp(session.createdAt)}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText title={session.signingKeyFingerprint}>
                    {compactRootIdentifier(session.signingKeyFingerprint)}
                  </MiniAppTableText>
                </MiniAppTableCell>
              </MiniAppTableRow>
            ))
          )}
        </tbody>
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function OrganizationsTable({
  organizations,
}: {
  organizations: ReadonlyArray<RootIdentityOrganization>;
}) {
  return (
    <MiniAppTableFrame>
      <MiniAppTable aria-label="Organizations" columns={ORGANIZATION_COLUMNS}>
        <tbody>
          {organizations.length === 0 ? (
            <MiniAppTableEmptyRow colSpan={ORGANIZATION_COLUMNS.length}>
              No organization memberships.
            </MiniAppTableEmptyRow>
          ) : (
            organizations.map((organization) => (
              <MiniAppTableRow key={organization.organizationId}>
                <MiniAppTableCell>
                  <MiniAppTableText title={organization.organizationId}>
                    {organization.name}
                    {organization.isDefaultOrganization ? " (default)" : ""}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText>
                    {organization.roster.status}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText>
                    {organization.billing?.status ?? "none"}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText truncate={false}>
                    {formatRootTimestamp(organization.billing?.trialEndsAt)}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText truncate={false}>
                    {formatRootTimestamp(
                      organization.billing?.currentPeriodEndsAt,
                    )}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText>
                    {organization.billing?.seatCount ?? 0}
                  </MiniAppTableText>
                </MiniAppTableCell>
              </MiniAppTableRow>
            ))
          )}
        </tbody>
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

export function IdentityDetailView({
  onBack,
  userId,
}: {
  onBack: () => void;
  userId: string;
}) {
  const { detail, error, loading, organizations, refresh } =
    useRootIdentityDetail(userId);

  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Identity</h2>
      </MiniAppSectionHeading>
      <MiniAppToolbar>
        <MiniAppButton onClick={onBack}>Back</MiniAppButton>
        <MiniAppButton disabled={loading} onClick={refresh}>
          {loading ? "Loading..." : "Refresh"}
        </MiniAppButton>
      </MiniAppToolbar>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {detail ? (
        <>
          <IdentitySummary identity={detail.identity} />
          <MiniAppInfoHeading>Live Sessions</MiniAppInfoHeading>
          <SessionsTable sessions={detail.sessions} />
        </>
      ) : (
        !error && <MiniAppStatus>Loading identity...</MiniAppStatus>
      )}
      {organizations && (
        <>
          <MiniAppInfoHeading>Organizations</MiniAppInfoHeading>
          <OrganizationsTable organizations={organizations} />
        </>
      )}
    </MiniAppSection>
  );
}
