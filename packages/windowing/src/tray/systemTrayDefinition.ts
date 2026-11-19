import type { ComponentType } from "react";
import type { WindowingIcon } from "../icons/windowingIcon";

/**
 * One tray app: a small control a host shows in its taskbar's tray, such as a
 * theme switch or a status indicator, which the user can turn off.
 */
export interface TrayAppDefinition {
  /** The control. It may render nothing where it does not apply. */
  component: ComponentType;
  /** Whether the control appears before the user chooses. Defaults to true. */
  defaultEnabled?: boolean;
  /** Drawn beside the title in Display Properties and the app's menu. */
  icon?: WindowingIcon | undefined;
  /** Names the app in Display Properties and its context menu. */
  title: string;
}

/** A host's tray apps and their order in the tray, start to end. */
export interface SystemTrayDefinition<Id extends string = string> {
  apps: Readonly<Record<Id, TrayAppDefinition>>;
  order: ReadonlyArray<Id>;
}
