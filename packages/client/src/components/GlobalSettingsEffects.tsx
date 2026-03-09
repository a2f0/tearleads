import {
  useBorderRadiusEffect,
  useFontEffect,
  useWindowOpacityEffect
} from '@tearleads/app-settings';

export function GlobalSettingsEffects() {
  useFontEffect();
  useWindowOpacityEffect();
  useBorderRadiusEffect();

  return null;
}
