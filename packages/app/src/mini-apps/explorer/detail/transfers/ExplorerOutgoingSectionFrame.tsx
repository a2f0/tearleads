import { type ReactNode, useId } from "react";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../../components/mini-app/MiniAppLayout";
import type { ExplorerOutgoingSection } from "../../routes";
import "./ExplorerOutgoingSectionFrame.css";

/** How the Outgoing panel finds a section to scroll it to the top. */
export function getOutgoingSectionSelector(
  section: ExplorerOutgoingSection,
): string {
  return `[data-outgoing-section="${section}"]`;
}

/**
 * One titled section of the Outgoing tab, labelled by its heading. The panel
 * around it owns the scroller and the tab's header.
 */
export function ExplorerOutgoingSectionFrame(params: {
  children: ReactNode;
  section: ExplorerOutgoingSection;
  summary: string;
  title: string;
}) {
  const headingId = useId();
  return (
    <MiniAppSection
      aria-labelledby={headingId}
      className="explorer-outgoing-section"
      data-outgoing-section={params.section}
    >
      <MiniAppSectionHeading>
        <h2 id={headingId}>{params.title}</h2>
        <span className="explorer-outgoing-section-summary">
          {params.summary}
        </span>
      </MiniAppSectionHeading>
      {params.children}
    </MiniAppSection>
  );
}
