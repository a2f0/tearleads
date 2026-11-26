import type { ReactNode } from "react";
import { MiniAppStatePanel } from "../mini-app/MiniAppLayout";
import { classNames } from "../shared/classNames";
import "./OnboardingStepPanel.css";

/**
 * An onboarding step laid out by the shape of whatever hosts it (a phone, a
 * tablet pane, a desktop window, the empty desktop, or the demo's page), not
 * the screen's. The outer box fills the host and is the size container the
 * step's own breakpoints query as `onboarding-step`; the state panel inside
 * centers the step's copy and `children` in it.
 */
export function OnboardingStepPanel({
  children,
  className,
  description,
  panelClassName,
  title,
}: {
  readonly children: ReactNode;
  /** Names the outer box, the one that scrolls when its host is too short. */
  readonly className: string;
  readonly description?: ReactNode;
  /** Names the state panel, the box a step lays its parts out in. */
  readonly panelClassName: string;
  readonly title: ReactNode;
}) {
  return (
    <div className={classNames("onboarding-step", className)}>
      <MiniAppStatePanel
        className={classNames("onboarding-step-panel", panelClassName)}
        description={description}
        title={title}
      >
        {children}
      </MiniAppStatePanel>
    </div>
  );
}
