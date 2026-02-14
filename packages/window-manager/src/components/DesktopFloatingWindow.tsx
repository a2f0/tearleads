import { FloatingWindow, type FloatingWindowProps } from './FloatingWindow.js';

export const DESKTOP_WINDOW_FOOTER_HEIGHT = 56;

export type DesktopFloatingWindowProps = Omit<
  FloatingWindowProps,
  'footerHeight'
>;

export function DesktopFloatingWindow(props: DesktopFloatingWindowProps) {
  return (
    <FloatingWindow {...props} footerHeight={DESKTOP_WINDOW_FOOTER_HEIGHT} />
  );
}
