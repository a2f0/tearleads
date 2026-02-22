import { useSettings } from '@tearleads/settings';
import {
  DesktopBackground as BaseDesktopBackground,
  type DesktopBackgroundProps as BaseDesktopBackgroundProps
} from '@tearleads/window-manager';

type DesktopBackgroundProps = Omit<BaseDesktopBackgroundProps, 'pattern'>;

/**
 * DesktopBackground component that reads the pattern from settings.
 * Wraps the window-manager DesktopBackground with settings integration.
 */
export function DesktopBackground({ className }: DesktopBackgroundProps) {
  const { getSetting } = useSettings();
  const pattern = getSetting('desktopPattern');
  return <BaseDesktopBackground pattern={pattern} className={className} />;
}
