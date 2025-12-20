/**
 * Get the Electron protocol scheme based on environment.
 */
export const getElectronProtocolScheme = (isDev: boolean): string => {
  return isDev ? 'rapid-dev' : 'rapid';
};
