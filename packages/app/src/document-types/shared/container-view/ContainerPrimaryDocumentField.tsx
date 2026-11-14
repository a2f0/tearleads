import type {
  ContainerDocumentQueries,
  ContainerDocumentSidebarRow,
  ContainerNode,
  DocumentSummary,
  DomainScope,
} from "@tearleads/client-sdk";
import { useCallback, useState } from "react";
import { MiniAppSelectMenu } from "../../../components/mini-app/controls/MiniAppSelectMenu";
import type { MiniAppSelectMenuOption } from "../../../components/mini-app/controls/MiniAppSelectMenuState";
import {
  MiniAppButton,
  MiniAppFieldGroup,
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { useContainerViewResource } from "./useContainerViewResource";
import { usePrimaryDocumentSave } from "./usePrimaryDocumentSave";

interface ContainerPrimaryDocumentFieldProps {
  scope: DomainScope;
  node: ContainerNode;
  documentQueries: ContainerDocumentQueries;
  revision: number;
  readOnly: boolean;
  setPrimary: (
    containerId: string,
    documentId: string | null,
  ) => Promise<ContainerNode | null>;
  logError: (message: string | Error, cause?: unknown) => void;
}

const PAGE_SIZE = 20;

function primaryOptions(
  rows: ReadonlyArray<ContainerDocumentSidebarRow> | undefined,
  primary: DocumentSummary | null | undefined,
  primaryId: ContainerNode["primaryDocumentId"],
) {
  const options: MiniAppSelectMenuOption[] = [{ id: "", label: "None" }];
  for (const row of rows ?? []) {
    if (row.documentId)
      options.push({
        id: row.documentId,
        label: row.title || "Untitled document",
      });
  }
  if (!primaryId || options.some((option) => option.id === primaryId))
    return options;
  let label = "Current primary document";
  if (primary !== undefined)
    label = primary
      ? primary.title || "Untitled document"
      : "Unavailable document";
  options.splice(1, 0, { id: primaryId, label });
  return options;
}

function PrimaryDocumentPages({
  offset,
  totalCount,
  busy,
  onPage,
}: {
  offset: number;
  totalCount: number | undefined;
  busy: boolean;
  onPage: (offset: number) => void;
}) {
  if (totalCount === undefined || totalCount <= PAGE_SIZE) return null;
  return (
    <nav aria-label="Primary document pages" className="mini-app-actions">
      <MiniAppButton
        disabled={busy || offset === 0}
        onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}
      >
        Previous documents
      </MiniAppButton>
      <span>{totalCount} documents</span>
      <MiniAppButton
        disabled={busy || offset + PAGE_SIZE >= totalCount}
        onClick={() => onPage(offset + PAGE_SIZE)}
      >
        Next documents
      </MiniAppButton>
    </nav>
  );
}

function ContainerPrimaryDocumentFieldSession({
  node,
  documentQueries,
  revision,
  setPrimary,
  logError,
}: ContainerPrimaryDocumentFieldProps) {
  const [offset, setOffset] = useState(0);
  const load = useCallback(async () => {
    void revision;
    const [page, primary] = await Promise.all([
      documentQueries.listContainerDocumentSidebarWindow({
        containerId: node.id,
        offset,
        limit: PAGE_SIZE,
      }),
      node.primaryDocumentId
        ? documentQueries.loadContainerDocumentSummary({
            containerId: node.id,
            documentId: node.primaryDocumentId,
          })
        : Promise.resolve(null),
    ]);
    return { page, primary };
  }, [node.id, node.primaryDocumentId, documentQueries, offset, revision]);
  const resource = useContainerViewResource(load);
  const data = resource.status === "ready" ? resource.value : null;
  const saving = usePrimaryDocumentSave({
    containerId: node.id,
    canManage: true,
    setPrimary,
    logError,
  });
  const busy = saving.state.status === "saving";
  const options = primaryOptions(
    data?.page.rows,
    data?.primary,
    node.primaryDocumentId,
  );

  return (
    <MiniAppInfoSection heading="Container view">
      <MiniAppFieldGroup>
        <span>Primary document</span>
        <MiniAppSelectMenu
          ariaLabel="Primary document"
          disabled={busy}
          onChange={(value) => {
            void saving.save(value || null);
          }}
          options={options}
          value={node.primaryDocumentId ?? ""}
        />
      </MiniAppFieldGroup>
      <p>
        Contact views show notes underneath. Other document types keep the
        contents list. Choose None to show contents without a primary document.
      </p>
      <p>New offline documents become available here after their first sync.</p>
      {resource.status === "loading" ? (
        <MiniAppStatus>Loading documents…</MiniAppStatus>
      ) : null}
      {resource.status === "failed" ? (
        <MiniAppStatus tone="error">{resource.error}</MiniAppStatus>
      ) : null}
      {data?.page.totalCount === 0 ? (
        <MiniAppStatus>No documents in this container.</MiniAppStatus>
      ) : null}
      <PrimaryDocumentPages
        offset={offset}
        totalCount={data?.page.totalCount}
        busy={busy}
        onPage={setOffset}
      />
      {busy ? <MiniAppStatus>Saving container view…</MiniAppStatus> : null}
      {saving.state.status === "failed" ? (
        <div role="alert">{saving.state.error}</div>
      ) : null}
    </MiniAppInfoSection>
  );
}

/** Saves and candidate pages belong to one container in one account scope. */
export function ContainerPrimaryDocumentField(
  props: ContainerPrimaryDocumentFieldProps,
) {
  const [session, setSession] = useState({
    scope: props.scope,
    containerId: props.node.id,
    key: 0,
  });
  if (session.scope !== props.scope || session.containerId !== props.node.id) {
    setSession({
      scope: props.scope,
      containerId: props.node.id,
      key: session.key + 1,
    });
  }
  if (
    props.readOnly ||
    props.node.metadataReady === false ||
    (props.node.effectiveAccessLevel !== "admin" &&
      props.node.effectiveAccessLevel !== "write")
  )
    return null;
  return <ContainerPrimaryDocumentFieldSession key={session.key} {...props} />;
}
