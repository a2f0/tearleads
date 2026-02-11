import {
  FloatingWindow as BaseFloatingWindow,
  type FloatingWindowProps as BaseFloatingWindowProps
} from '@tearleads/window-manager';
import { FOOTER_HEIGHT } from '@/constants/layout';

export type { WindowDimensions } from '@tearleads/window-manager';

export type FloatingWindowProps = Omit<BaseFloatingWindowProps, 'footerHeight'>;

export function FloatingWindow(props: FloatingWindowProps) {
  return <BaseFloatingWindow {...props} footerHeight={FOOTER_HEIGHT} />;
}
