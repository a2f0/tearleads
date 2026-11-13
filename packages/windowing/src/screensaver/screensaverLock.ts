export interface ScreensaverLock {
  /** Lock the host's protected state synchronously when a session starts. */
  lock: () => void;
  /** Return true only after the host has verified the PIN and unlocked. */
  unlock: (pin: string) => Promise<boolean>;
}
