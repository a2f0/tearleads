import { useBorderRadiusEffect } from '@/hooks/useBorderRadiusEffect';
import { useFontEffect } from '@/hooks/useFontEffect';
import { useWindowOpacityEffect } from '@/hooks/useWindowOpacityEffect';

export function GlobalSettingsEffects() {
  useFontEffect();
  useWindowOpacityEffect();
  useBorderRadiusEffect();

  return null;
}
