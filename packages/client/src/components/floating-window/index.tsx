import {
  FloatingWindow as BaseFloatingWindow,
  type FloatingWindowProps as BaseFloatingWindowProps
} from '@rapid/window-manager';
import { FOOTER_HEIGHT } from '@/constants/layout';

export type { WindowDimensions } from '@rapid/window-manager';

export type FloatingWindowProps = Omit<BaseFloatingWindowProps, 'footerHeight'>;

export function FloatingWindow(props: FloatingWindowProps) {
  return <BaseFloatingWindow {...props} footerHeight={FOOTER_HEIGHT} />;
}
