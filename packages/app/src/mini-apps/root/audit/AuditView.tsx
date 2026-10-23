import type { RootAuditEvent } from "@tearleads/client-sdk";
import { useCallback } from "react";
import {
  MiniAppButton,
  MiniAppInput,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../components/mini-app/MiniAppTable";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  compactRootIdentifier,
  formatRootTimestamp,
} from "../identities/rootDisplay";
import { useRootPage } from "../organizations/useRootPage";
import { rootAuditActionLabel } from "./auditLabels";
import { useAuditSubjectDraft } from "./useAuditSubjectDraft";

const COLUMNS = [
  { id: "when", header: "When", width: "10rem" },
  { id: "operator", header: "Operator" },
  { id: "action", header: "Action" },
  { id: "target", header: "Target" },
  { id: "filter", header: "Filter" },
  { id: "ip", header: "IP", width: "9rem" },
];

interface AuditLinks {
  onSelectIdentity: (userId: string) => void;
  onSelectOrganization: (organizationId: string) => void;
}

function AuditTarget({
  event,
  onSelectIdentity,
  onSelectOrganization,
}: AuditLinks & { event: RootAuditEvent }) {
  const { targetOrganizationId, targetUserId } = event;
  if (targetUserId !== null) {
    return (
      <MiniAppTableActionButton
        onClick={() => onSelectIdentity(targetUserId)}
        title={targetUserId}
      >
        Identity {compactRootIdentifier(targetUserId)}
      </MiniAppTableActionButton>
    );
  }
  if (targetOrganizationId !== null) {
    return (
      <MiniAppTableActionButton
        onClick={() => onSelectOrganization(targetOrganizationId)}
        title={targetOrganizationId}
      >
        Organization {compactRootIdentifier(targetOrganizationId)}
      </MiniAppTableActionButton>
    );
  }
  return <MiniAppTableText muted>None</MiniAppTableText>;
}

function AuditRow({ event, ...links }: AuditLinks & { event: RootAuditEvent }) {
  const { actorSigningKeyFingerprint, actorUserId } = event;
  return (
    <MiniAppTableRow>
      <MiniAppTableCell>
        <MiniAppTableText truncate={false}>
          {formatRootTimestamp(event.occurredAt)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        {actorUserId === null ? (
          <MiniAppTableText>API CLI</MiniAppTableText>
        ) : (
          <MiniAppTableActionButton
            onClick={() => links.onSelectIdentity(actorUserId)}
            title={actorSigningKeyFingerprint ?? actorUserId}
          >
            {compactRootIdentifier(actorSigningKeyFingerprint ?? actorUserId)}
          </MiniAppTableActionButton>
        )}
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText title={event.action}>
          {rootAuditActionLabel(event.action)}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <AuditTarget event={event} {...links} />
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText
          muted={event.filter === null}
          title={event.filter ?? undefined}
        >
          {event.filter ?? "None"}
        </MiniAppTableText>
      </MiniAppTableCell>
      <MiniAppTableCell>
        <MiniAppTableText muted={event.sourceIpAddress === null}>
          {event.sourceIpAddress ?? "Unknown"}
        </MiniAppTableText>
      </MiniAppTableCell>
    </MiniAppTableRow>
  );
}

export function AuditView({
  subjectId,
  onSubjectChange,
  ...links
}: AuditLinks & {
  subjectId: string | null;
  onSubjectChange: (subjectId: string | null) => void;
}) {
  const tearleads = useTearleads();
  const { draft, draftIsIncomplete, updateDraft } = useAuditSubjectDraft(
    subjectId,
    onSubjectChange,
  );
  const request = useCallback(
    async (cursor: string | null) => {
      const result = await tearleads.root.listAuditEvents({
        ...(subjectId === null ? {} : { subjectId }),
        ...(cursor === null ? {} : { cursor }),
      });
      return result.ok
        ? {
            ok: true as const,
            data: {
              items: result.data.events,
              nextCursor: result.data.nextCursor,
            },
          }
        : result;
    },
    [subjectId, tearleads],
  );
  const { items, error, loading, nextCursor, loadMore, refresh } =
    useRootPage(request);
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Audit</h2>
      </MiniAppSectionHeading>
      <MiniAppStatus>
        Every root lookup and root access change, newest first. Viewing this
        trail is recorded too.
      </MiniAppStatus>
      <MiniAppToolbar wrap>
        <MiniAppInput
          aria-label="Filter by identity or organization ID"
          className="root-console-filter"
          onChange={(event) => updateDraft(event.target.value)}
          placeholder="Identity or organization ID"
          spellCheck={false}
          value={draft}
        />
        <MiniAppButton disabled={loading} onClick={refresh}>
          {loading ? "Loading..." : "Refresh"}
        </MiniAppButton>
      </MiniAppToolbar>
      {draftIsIncomplete && (
        <MiniAppStatus>Enter a full user or organization ID.</MiniAppStatus>
      )}
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      <MiniAppTableFrame>
        <MiniAppTable aria-label="Audit events" columns={COLUMNS}>
          {items.length === 0 ? (
            <MiniAppTableEmptyRow colSpan={COLUMNS.length}>
              {loading ? "Loading audit events..." : "No audit events."}
            </MiniAppTableEmptyRow>
          ) : (
            items.map((event) => (
              <AuditRow event={event} key={event.id} {...links} />
            ))
          )}
        </MiniAppTable>
      </MiniAppTableFrame>
      {nextCursor !== null && (
        <MiniAppToolbar>
          <MiniAppButton disabled={loading} onClick={loadMore}>
            Load more
          </MiniAppButton>
        </MiniAppToolbar>
      )}
    </MiniAppSection>
  );
}
