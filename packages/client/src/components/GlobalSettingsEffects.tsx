import {
  useBorderRadiusEffect,
  useFontEffect,
  useWindowOpacityEffect
} from '@tearleads/settings';

export function GlobalSettingsEffects() {
  useFontEffect();
  useWindowOpacityEffect();
  useBorderRadiusEffect();

  return null;
}
