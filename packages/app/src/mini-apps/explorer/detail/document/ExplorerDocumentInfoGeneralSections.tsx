import type { DocumentInfo } from "@symcrypt/client-sdk";
import {
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "@symcrypt/client-sdk";
import type { CSSProperties } from "react";
import {
  MiniAppInfoSection,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppKeyValueTable,
} from "../../../../components/mini-app/MiniAppTable";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../../document-types/projectors";
import { formatMiniAppDateTime } from "../../../../utils/formatMiniAppDate";
import {
  EXPLORER_LABELS,
  getExplorerDocumentInfoPendingChangesLabel,
} from "../../labels";
import {
  type ExplorerAttributionUserLabelResolver,
  getExplorerAttributionWriterLabel,
  getExplorerAttributionWriterTitle,
} from "../attributionDisplay";
import { compactId } from "../compactId";
import "./ExplorerDocumentInfoBlame.css";

interface ExplorerAttributionLabelParams {
  attributionUserLabelResolver?:
    | ExplorerAttributionUserLabelResolver
    | undefined;
}

function getDocumentTypeLabel(documentKind: StoredDocumentKind | null): string {
  return documentKind
    ? getStoredDocumentTypeLabel(
        documentKind,
        APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      )
    : "-";
}

export function ExplorerDocumentInfoGeneralSection(params: {
  containerName: string | null;
  documentInfo: DocumentInfo | null;
  localId: string;
}) {
  const { containerName, documentInfo, localId } = params;
  const local = documentInfo?.local;
  const pendingChanges = local
    ? getExplorerDocumentInfoPendingChangesLabel({
        pendingAttachmentByteLength: local.pendingAttachmentByteLength,
        pendingAttachmentCount: local.pendingAttachmentCount,
        pendingUpdateCount: local.pendingUpdateCount,
      })
    : "-";

  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.documentInfoGeneralHeading}>
      <MiniAppKeyValueTable>
        <tbody>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoIdRow}
            title={localId}
          >
            {compactId(localId)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoDocumentIdRow}
            title={local?.documentId}
          >
            {compactId(local?.documentId)}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.documentInfoTypeRow}>
            {getDocumentTypeLabel(local?.documentKind ?? null)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoContainerRow}
            title={local?.containerId}
          >
            {containerName ?? compactId(local?.containerId)}
          </MiniAppInfoRow>
          <MiniAppInfoRow
            label={EXPLORER_LABELS.documentInfoUpdatedRow}
            title={local?.updatedAt}
          >
            {formatMiniAppDateTime(local?.updatedAt ?? null, {
              emptyFallback: "-",
            })}
          </MiniAppInfoRow>
          <MiniAppInfoRow label={EXPLORER_LABELS.documentInfoPendingChangesRow}>
            {pendingChanges}
          </MiniAppInfoRow>
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppInfoSection>
  );
}

function formatContributorOps(contributor: {
  opCount: number;
  hasDirectAuthority: boolean;
}): string {
  const edits = `${contributor.opCount} ${
    contributor.opCount === 1
      ? EXPLORER_LABELS.documentInfoContributorOpSingular
      : EXPLORER_LABELS.documentInfoContributorOpPlural
  }`;
  // A contributor credited only via a rotate_baseline re-assertion is the first
  // signed uploader of those ops, not a proven author — flag that distinction.
  return contributor.hasDirectAuthority
    ? edits
    : `${edits} ${EXPLORER_LABELS.documentInfoContributorReasserted}`;
}

export function ExplorerDocumentInfoContributorsSection(
  params: ExplorerAttributionLabelParams & {
    documentInfo: DocumentInfo | null;
  },
) {
  const remoteInfo = params.documentInfo?.remoteInfo;
  if (!remoteInfo) {
    return null;
  }
  if (remoteInfo.attributionStatus === "unavailable") {
    return (
      <MiniAppInfoSection
        heading={EXPLORER_LABELS.documentInfoContributorsHeading}
      >
        <MiniAppStatus tone="error">
          {EXPLORER_LABELS.documentInfoAttributionUnavailable}
        </MiniAppStatus>
      </MiniAppInfoSection>
    );
  }
  if (remoteInfo.attributionStatus === "truncated") {
    return (
      <MiniAppInfoSection
        heading={EXPLORER_LABELS.documentInfoContributorsHeading}
      >
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoAttributionTruncated}
        </MiniAppStatus>
      </MiniAppInfoSection>
    );
  }
  const contributors = remoteInfo.contributors;
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoContributorsHeading}
    >
      {contributors.length === 0 ? (
        <MiniAppStatus>
          {EXPLORER_LABELS.documentInfoNoContributors}
        </MiniAppStatus>
      ) : (
        <MiniAppKeyValueTable>
          <tbody>
            {contributors.map((contributor) => (
              <MiniAppInfoRow
                key={`${contributor.writerUserId}:${contributor.writerKeyFingerprint}`}
                label={getExplorerAttributionWriterLabel(
                  contributor,
                  params.attributionUserLabelResolver,
                )}
                title={getExplorerAttributionWriterTitle(
                  contributor,
                  params.attributionUserLabelResolver,
                )}
              >
                {formatContributorOps(contributor)}
              </MiniAppInfoRow>
            ))}
          </tbody>
        </MiniAppKeyValueTable>
      )}
    </MiniAppInfoSection>
  );
}

function formatCharacterCount(count: number): string {
  return `${count} ${
    count === 1
      ? EXPLORER_LABELS.documentInfoCharacterBlameCharacterSingular
      : EXPLORER_LABELS.documentInfoCharacterBlameCharacterPlural
  }`;
}

function formatBlameCharacters(writer: {
  characterCount: number;
  hasDirectAuthority: boolean;
}): string {
  const characters = formatCharacterCount(writer.characterCount);
  // A writer credited only via a rotate_baseline re-assertion is the first signed
  // uploader of those characters, not a proven author — flag that distinction.
  return writer.hasDirectAuthority
    ? characters
    : `${characters} ${EXPLORER_LABELS.documentInfoContributorReasserted}`;
}

export function ExplorerDocumentInfoCharacterBlameSection(
  params: ExplorerAttributionLabelParams & {
    documentInfo: DocumentInfo | null;
  },
) {
  const blame = params.documentInfo?.remoteInfo?.characterBlame;
  // Per-writer authorship of the CURRENT text — the live-character counterpart to
  // the Contributors op-count rollup. Hidden when blame could not be computed (no
  // local snapshot, too large to scan, or unreadable) or the document is empty.
  // A document whose characters are all still unattributed (e.g. local edits the
  // attribution feed has not caught up to) keeps the section, surfacing that count.
  if (
    !blame ||
    (blame.writers.length === 0 && blame.unattributedCharacterCount === 0)
  ) {
    return null;
  }
  return (
    <MiniAppInfoSection
      heading={EXPLORER_LABELS.documentInfoCharacterBlameHeading}
    >
      <MiniAppKeyValueTable>
        <tbody>
          {blame.writers.map((writer) => (
            <MiniAppInfoRow
              key={`${writer.writerUserId}:${writer.writerKeyFingerprint}`}
              label={getExplorerAttributionWriterLabel(
                writer,
                params.attributionUserLabelResolver,
              )}
              title={getExplorerAttributionWriterTitle(
                writer,
                params.attributionUserLabelResolver,
              )}
            >
              {formatBlameCharacters(writer)}
            </MiniAppInfoRow>
          ))}
          {blame.unattributedCharacterCount > 0 ? (
            <MiniAppInfoRow
              label={EXPLORER_LABELS.documentInfoCharacterBlameUnattributed}
            >
              {formatCharacterCount(blame.unattributedCharacterCount)}
            </MiniAppInfoRow>
          ) : null}
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppInfoSection>
  );
}

type DocumentInfoBlameRange = NonNullable<
  DocumentInfo["remoteInfo"]
>["blameRanges"];

// Hashing each fingerprint to a hue in isolation gives no guarantee that the two
// or three writers actually on screen land on *contrasting* colors — two
// unrelated identities can hash to nearly the same hue (e.g. both green). Instead
// we assign hues by first-appearance order and step by the golden angle, so the
// writers present always get well-separated colors while each keeps one stable
// color across the prose and the legend. Golden-angle stepping also leaves
// earlier writers' colors put as later writers append.
const BLAME_GOLDEN_ANGLE = 137.508;

function blameHueForIndex(index: number): number {
  return Math.round((index * BLAME_GOLDEN_ANGLE) % 360);
}

// Translucent fill + underline so the tint reads on either theme without
// fighting the editor text color.
function blameRunStyle(hue: number): CSSProperties {
  return {
    backgroundColor: `hsla(${hue}, 70%, 55%, 0.28)`,
    borderBottom: `2px solid hsla(${hue}, 70%, 50%, 0.85)`,
  };
}

function blameSwatchStyle(hue: number): CSSProperties {
  return {
    backgroundColor: `hsla(${hue}, 70%, 50%, 0.85)`,
  };
}

function blameRunTitle(
  range: NonNullable<DocumentInfoBlameRange>[number],
  resolveUserLabel?: ExplorerAttributionUserLabelResolver | undefined,
): string {
  if (!range.writerUserId || !range.writerKeyFingerprint) {
    return EXPLORER_LABELS.documentInfoBlameUnattributedTitle;
  }
  const identity =
    getExplorerAttributionWriterTitle(range, resolveUserLabel) ??
    `${range.writerUserId} · ${range.writerKeyFingerprint}`;
  // A run credited only via a rotate_baseline re-assertion is the first signed
  // uploader of that span, not a proven author — carry the same caveat the
  // Contributors/Character Blame rows show.
  return range.authorityKind === "baseline"
    ? `${identity} ${EXPLORER_LABELS.documentInfoContributorReasserted}`
    : identity;
}

export function ExplorerDocumentInfoBlameSection(
  params: ExplorerAttributionLabelParams & {
    documentInfo: DocumentInfo | null;
  },
) {
  const ranges = params.documentInfo?.remoteInfo?.blameRanges;
  // The current prose tinted by who wrote each run — the per-range counterpart to
  // the per-writer Character Blame rollup. Hidden when ranges could not be
  // computed (no local snapshot, too large to scan, or unreadable) or the
  // document is empty; an all-unattributed document keeps the section (every run
  // renders neutral), surfacing that the attribution feed has not caught up.
  if (!ranges || ranges.length === 0) {
    return null;
  }
  const legend: Array<{ writerKeyFingerprint: string; writerUserId: string }> =
    [];
  const hues = new Map<string, number>();
  const seenWriters = new Set<string>();
  let hasUnattributed = false;
  for (const range of ranges) {
    if (!range.writerKeyFingerprint) {
      hasUnattributed = true;
      continue;
    }
    // Prose runs color on fingerprint alone, so give every fingerprinted run a
    // hue — stepped by the golden angle in first-appearance order so the writers
    // present stay well separated and each keeps one color across prose + legend.
    if (!hues.has(range.writerKeyFingerprint)) {
      hues.set(range.writerKeyFingerprint, blameHueForIndex(hues.size));
    }
    if (!range.writerUserId) {
      hasUnattributed = true;
      continue;
    }
    if (!seenWriters.has(range.writerKeyFingerprint)) {
      seenWriters.add(range.writerKeyFingerprint);
      legend.push({
        writerKeyFingerprint: range.writerKeyFingerprint,
        writerUserId: range.writerUserId,
      });
    }
  }
  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.documentInfoBlameHeading}>
      <div className="explorer-blame-prose">
        {ranges.map((range) => (
          <span
            className={
              range.writerKeyFingerprint
                ? "explorer-blame-run"
                : "explorer-blame-run explorer-blame-run--unattributed"
            }
            key={`${range.startIndex}-${range.endIndex}`}
            style={
              range.writerKeyFingerprint
                ? blameRunStyle(hues.get(range.writerKeyFingerprint) ?? 0)
                : undefined
            }
            title={blameRunTitle(range, params.attributionUserLabelResolver)}
          >
            {range.text}
          </span>
        ))}
      </div>
      <ul className="explorer-blame-legend">
        {legend.map((writer) => (
          <li
            className="explorer-blame-legend-item"
            key={`${writer.writerUserId}:${writer.writerKeyFingerprint}`}
            title={getExplorerAttributionWriterTitle(
              writer,
              params.attributionUserLabelResolver,
            )}
          >
            <span
              className="explorer-blame-swatch"
              style={blameSwatchStyle(
                hues.get(writer.writerKeyFingerprint) ?? 0,
              )}
            />
            {getExplorerAttributionWriterLabel(
              writer,
              params.attributionUserLabelResolver,
            )}
          </li>
        ))}
        {hasUnattributed ? (
          <li
            className="explorer-blame-legend-item"
            title={EXPLORER_LABELS.documentInfoBlameUnattributedTitle}
          >
            <span className="explorer-blame-swatch explorer-blame-swatch--unattributed" />
            {EXPLORER_LABELS.documentInfoCharacterBlameUnattributed}
          </li>
        ) : null}
      </ul>
    </MiniAppInfoSection>
  );
}

// camelCase / snake_case / kebab-case field key -> Title Case words for display
// (firstName -> "First Name", card_number -> "Card Number").
function humanizeFieldKey(fieldKey: string): string {
  const words = fieldKey
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[\s_-]+/u)
    .filter((word) => word.length > 0);
  return words.length > 0
    ? words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : fieldKey;
}

export function ExplorerDocumentInfoFieldBlameSection(
  params: ExplorerAttributionLabelParams & {
    documentInfo: DocumentInfo | null;
  },
) {
  const fieldBlame = params.documentInfo?.remoteInfo?.fieldBlame;
  // Hidden when field blame could not be
  // computed or the document has no fields (e.g. a note, whose prose is covered
  // by the Blame section instead).
  if (!fieldBlame || fieldBlame.length === 0) {
    return null;
  }
  return (
    <MiniAppInfoSection heading={EXPLORER_LABELS.documentInfoFieldBlameHeading}>
      <MiniAppKeyValueTable>
        <tbody>
          {fieldBlame.map((field) => (
            <MiniAppInfoRow
              key={field.fieldKey}
              label={humanizeFieldKey(field.fieldKey)}
              title={getExplorerAttributionWriterTitle(
                field,
                params.attributionUserLabelResolver,
              )}
            >
              {field.writerKeyFingerprint
                ? getExplorerAttributionWriterLabel(
                    field,
                    params.attributionUserLabelResolver,
                  )
                : EXPLORER_LABELS.documentInfoCharacterBlameUnattributed}
            </MiniAppInfoRow>
          ))}
        </tbody>
      </MiniAppKeyValueTable>
    </MiniAppInfoSection>
  );
}
