import type { UserSession } from "@tearleads/client-sdk";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppClipboardButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppSection,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppInfoTable,
} from "../../components/shared/MiniAppTable";
import { formatMiniAppDateTime } from "../../utils/formatMiniAppDate";
import {
  compactIdentifier,
  getSessionStatusLabel,
  sessionIpAddressesTitle,
  sessionIsMutating,
} from "./IdentityManagerSessionDisplay";

function SessionDetailValue({
  copyLabel,
  title,
  value,
}: {
  copyLabel?: string | undefined;
  title?: string | null | undefined;
  value: string;
}) {
  return (
    <span className="identity-manager-session-detail-value">
      <span title={title ?? value}>{value}</span>
      {copyLabel ? (
        <MiniAppClipboardButton label={copyLabel} value={value} />
      ) : null}
    </span>
  );
}

function SessionIpAddressList({
  ipAddresses,
}: {
  ipAddresses: ReadonlyArray<string>;
}) {
  if (ipAddresses.length === 0) {
    return <>None</>;
  }

  return (
    <span className="identity-manager-session-ip-list">
      {ipAddresses.map((ipAddress) => (
        <code key={ipAddress}>{ipAddress}</code>
      ))}
    </span>
  );
}

export function SessionDetailSection({
  handleEndSession,
  mutatingSessionId,
  onBack,
  session,
}: {
  handleEndSession: (session: UserSession) => Promise<void>;
  mutatingSessionId: string | null;
  onBack: () => void;
  session: UserSession;
}) {
  const rowIsMutating = sessionIsMutating(mutatingSessionId, session);

  return (
    <MiniAppSection className="identity-manager-session-detail">
      <MiniAppHeader className="identity-manager-session-detail-header">
        <MiniAppHeaderCopy>
          <strong>{getSessionStatusLabel(session)} Session</strong>
          <span title={session.id}>{compactIdentifier(session.id)}</span>
        </MiniAppHeaderCopy>
        <MiniAppActions>
          <MiniAppButton
            disabled={mutatingSessionId !== null}
            onClick={() => void handleEndSession(session)}
          >
            {rowIsMutating ? "Working..." : "Log Out Session"}
          </MiniAppButton>
          <MiniAppButton onClick={onBack} variant="ghost">
            Back
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppInfoTable>
        <tbody>
          <MiniAppInfoRow label="Status">
            {getSessionStatusLabel(session)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label="Last Active" title={session.lastActiveAt}>
            {formatMiniAppDateTime(session.lastActiveAt)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label="Last IP"
            title={session.lastActiveIp ?? "No recorded IP"}
          >
            {session.lastActiveIp ?? "None"}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label="Full IP List"
            title={sessionIpAddressesTitle(session.ipAddresses)}
          >
            <SessionIpAddressList ipAddresses={session.ipAddresses} />
          </MiniAppInfoRow>
          <MiniAppInfoRow label="Created" title={session.createdAt}>
            {formatMiniAppDateTime(session.createdAt)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label="Signing Key"
            title={session.signingKeyFingerprint}
          >
            <SessionDetailValue
              copyLabel="Copy signing key"
              value={session.signingKeyFingerprint}
            />
          </MiniAppInfoRow>
          <MiniAppInfoRow label="Session ID" title={session.id}>
            <SessionDetailValue
              copyLabel="Copy session ID"
              value={session.id}
            />
          </MiniAppInfoRow>
        </tbody>
      </MiniAppInfoTable>
    </MiniAppSection>
  );
}
