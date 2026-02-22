import {
  DesktopFloatingWindow as BaseFloatingWindow,
  type DesktopFloatingWindowProps as BaseFloatingWindowProps
} from '@tearleads/window-manager';

export type { WindowDimensions } from '@tearleads/window-manager';

type FloatingWindowProps = BaseFloatingWindowProps;

export function FloatingWindow(props: FloatingWindowProps) {
  return <BaseFloatingWindow {...props} />;
}
