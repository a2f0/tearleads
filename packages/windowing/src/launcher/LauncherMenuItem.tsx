import type { WindowingIcon } from "../icons/windowingIcon";
import { MenuItem } from "../menu/MenuItem";
import { useLauncherEntryMenu } from "./useLauncherEntryMenu";

export function LauncherMenuItem({
  icon,
  label,
  onClick,
}: {
  icon?: WindowingIcon | undefined;
  label: string;
  onClick: () => void;
}) {
  const { menu, triggerProps } = useLauncherEntryMenu(icon, onClick);
  return (
    <>
      <MenuItem {...triggerProps} icon={icon} label={label} onClick={onClick} />
      {menu}
    </>
  );
}
