import type { WindowingIcon } from "../icons/windowingIcon";

interface AppSwitchProps {
  checked: boolean;
  className: string;
  icon?: WindowingIcon | undefined;
  onChange: (checked: boolean) => void;
  title: string;
}

export function AppSwitch({
  checked,
  className,
  icon: Icon,
  onChange,
  title,
}: AppSwitchProps) {
  return (
    <label className={`display-properties-app-switch ${className}`}>
      {Icon && (
        <Icon
          className={`display-properties-app-switch-icon ${className}-icon`}
          aria-hidden="true"
          focusable="false"
          size={16}
        />
      )}
      <span className="display-properties-label">{title}</span>
      <input
        aria-checked={checked}
        checked={checked}
        className="display-properties-switch"
        onChange={(event) => onChange(event.currentTarget.checked)}
        role="switch"
        type="checkbox"
      />
    </label>
  );
}
