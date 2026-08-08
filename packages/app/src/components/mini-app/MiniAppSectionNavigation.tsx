import type { Icon } from "@phosphor-icons/react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { type MouseEvent, useMemo } from "react";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
} from "../window/WindowSidebarContext";
import { MiniAppSidebar } from "./MiniAppLayout";
import { MiniAppRowButton, MiniAppRowText } from "./rows/MiniAppRow";
import "./MiniAppSectionNavigation.css";

export interface MiniAppSection<
  TView extends string,
  TContextMenuTarget = never,
> {
  contextMenuTarget?: TContextMenuTarget;
  icon: Icon;
  label: string;
  view: TView;
}

type MiniAppSectionNavigationProps<
  TSelectedView extends string,
  TView extends TSelectedView,
  TContextMenuTarget,
> = {
  sections: ReadonlyArray<MiniAppSection<TView, TContextMenuTarget>>;
  setView: (view: TSelectedView) => void;
} & (
  | {
      ariaLabel: string;
      variant: "menu";
    }
  | {
      onContextMenu?:
        | ((event: MouseEvent<HTMLElement>, target: TContextMenuTarget) => void)
        | undefined;
      selectedView: TSelectedView;
      variant: "sidebar";
    }
);

export function MiniAppSectionNavigation<
  TSelectedView extends string,
  TView extends TSelectedView,
  TContextMenuTarget,
>(
  props: MiniAppSectionNavigationProps<
    TSelectedView,
    TView,
    TContextMenuTarget
  >,
) {
  const rows = props.sections.map(
    ({ contextMenuTarget, icon: SectionIcon, label, view }) => (
      <MiniAppRowButton
        key={view}
        onClick={() => props.setView(view)}
        onContextMenu={
          props.variant === "sidebar" && contextMenuTarget !== undefined
            ? (event) => props.onContextMenu?.(event, contextMenuTarget)
            : undefined
        }
        selected={props.variant === "sidebar" && props.selectedView === view}
      >
        <SectionIcon
          aria-hidden
          className="mini-app-section-navigation-icon"
          size={20}
        />
        <MiniAppRowText>{label}</MiniAppRowText>
        {props.variant === "menu" ? (
          <CaretRightIcon
            aria-hidden
            className="mini-app-section-navigation-caret"
            size={16}
          />
        ) : null}
      </MiniAppRowButton>
    ),
  );

  if (props.variant === "menu") {
    return (
      <nav aria-label={props.ariaLabel} className="mini-app-section-menu">
        {rows}
      </nav>
    );
  }

  return <MiniAppSidebar>{rows}</MiniAppSidebar>;
}

export function useMiniAppSectionSidebarPanel<
  TSelectedView extends string,
  TView extends TSelectedView,
  TContextMenuTarget,
>(params: {
  enabled?: boolean;
  onContextMenu?:
    | ((event: MouseEvent<HTMLElement>, target: TContextMenuTarget) => void)
    | undefined;
  sections: ReadonlyArray<MiniAppSection<TView, TContextMenuTarget>>;
  selectedView: TSelectedView;
  setView: (view: TSelectedView) => void;
}) {
  const { setSidebar } = useWindowSidebar();
  const sidebar = useMemo(
    () => (
      <MiniAppSectionNavigation
        onContextMenu={params.onContextMenu}
        sections={params.sections}
        selectedView={params.selectedView}
        setView={params.setView}
        variant="sidebar"
      />
    ),
    [
      params.onContextMenu,
      params.sections,
      params.selectedView,
      params.setView,
    ],
  );

  useRegisteredWindowSidebar({
    enabled: params.enabled ?? true,
    setSidebar,
    sidebar,
  });
}
