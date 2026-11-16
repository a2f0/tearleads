import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { SkipBackIcon } from "@phosphor-icons/react/dist/csr/SkipBack";
import { SkipForwardIcon } from "@phosphor-icons/react/dist/csr/SkipForward";
import type { ReactNode } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { formatMiniAppDateTimeSeconds } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import "./ExplorerDocumentHistory.css";

const ICON_SIZE = 18;

function TimelineButton(params: {
  children: ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <MiniAppButton
      aria-label={params.label}
      className="mini-app-icon-button"
      disabled={params.disabled}
      onClick={params.onClick}
      title={params.label}
    >
      {params.children}
    </MiniAppButton>
  );
}

/**
 * The history transport: jump, step, play, and a slider over every change,
 * with the selected change's time and what it changed.
 */
export function DocumentHistoryTimeline(params: {
  /** Phrases describing the change on screen; null while it replays. */
  changeSummary: ReadonlyArray<string> | null;
  committedAt: number | null;
  newerAvailable: boolean;
  onReload: () => void;
  onSeek: (index: number) => void;
  onStep: (delta: -1 | 1) => void;
  onTogglePlay: () => void;
  playing: boolean;
  selectedIndex: number;
  stopCount: number;
}) {
  const last = params.stopCount - 1;
  const atFirst = params.selectedIndex <= 0;
  const atLast = params.selectedIndex >= last;
  const position = `${params.selectedIndex + 1} / ${params.stopCount}`;

  return (
    <section
      aria-label={EXPLORER_LABELS.documentHistorySubtitle}
      className="explorer-document-history-timeline"
    >
      <div className="explorer-document-history-transport">
        <TimelineButton
          disabled={atFirst}
          label={EXPLORER_LABELS.documentHistoryFirstAction}
          onClick={() => params.onSeek(0)}
        >
          <SkipBackIcon aria-hidden size={ICON_SIZE} />
        </TimelineButton>
        <TimelineButton
          disabled={atFirst}
          label={EXPLORER_LABELS.documentHistoryPreviousAction}
          onClick={() => params.onStep(-1)}
        >
          <CaretLeftIcon aria-hidden size={ICON_SIZE} />
        </TimelineButton>
        <TimelineButton
          disabled={last === 0}
          label={
            params.playing
              ? EXPLORER_LABELS.documentHistoryPauseAction
              : EXPLORER_LABELS.documentHistoryPlayAction
          }
          onClick={params.onTogglePlay}
        >
          {params.playing ? (
            <PauseIcon aria-hidden size={ICON_SIZE} />
          ) : (
            <PlayIcon aria-hidden size={ICON_SIZE} />
          )}
        </TimelineButton>
        <TimelineButton
          disabled={atLast}
          label={EXPLORER_LABELS.documentHistoryNextAction}
          onClick={() => params.onStep(1)}
        >
          <CaretRightIcon aria-hidden size={ICON_SIZE} />
        </TimelineButton>
        <TimelineButton
          disabled={atLast}
          label={EXPLORER_LABELS.documentHistoryLastAction}
          onClick={() => params.onSeek(last)}
        >
          <SkipForwardIcon aria-hidden size={ICON_SIZE} />
        </TimelineButton>
        <input
          aria-label={EXPLORER_LABELS.documentHistoryPositionLabel}
          aria-valuetext={position}
          className="explorer-document-history-slider"
          disabled={last === 0}
          max={last}
          min={0}
          onChange={(event) => params.onSeek(Number(event.target.value))}
          step={1}
          type="range"
          value={params.selectedIndex}
        />
        <span className="explorer-document-history-position">{position}</span>
      </div>
      <p className="explorer-document-history-caption">
        <strong>
          {formatMiniAppDateTimeSeconds(params.committedAt, {
            emptyFallback: EXPLORER_LABELS.documentHistoryTimeUnknown,
          })}
        </strong>
        {/* Keeps its line while a stop replays, so the document never jumps. */}
        <span>{params.changeSummary?.join(" · ") ?? " "}</span>
      </p>
      {params.newerAvailable ? (
        <div className="explorer-document-history-newer">
          <MiniAppStatus as="span">
            {EXPLORER_LABELS.documentHistoryNewerAvailable}
          </MiniAppStatus>
          <MiniAppButton onClick={params.onReload}>
            {EXPLORER_LABELS.documentHistoryReloadAction}
          </MiniAppButton>
        </div>
      ) : null}
    </section>
  );
}
