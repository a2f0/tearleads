import type { ReactNode } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
} from "../../../components/mini-app/MiniAppLayout";
import "./ExplorerDetailHeaderIdentity.css";

/**
 * The header of a Get Info panel: the glyph of the container or document the
 * panel describes, beside the panel's title and that item's name. The glyph is
 * the one the item's own header and list row show, so the panel names its
 * subject the way the place the user came from did.
 */
export function ExplorerInfoHeader(params: {
  /** Rendered with the `explorer-detail-header-icon` class. */
  icon: ReactNode;
  subject: string;
  title: string;
}) {
  return (
    <MiniAppHeader>
      <div className="explorer-detail-header-identity">
        {params.icon}
        <MiniAppHeaderCopy>
          <strong>{params.title}</strong>
          <span>{params.subject}</span>
        </MiniAppHeaderCopy>
      </div>
    </MiniAppHeader>
  );
}
