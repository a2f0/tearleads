import { App } from '@capacitor/app';
import { useEffect, useState } from 'react';
import { detectPlatform } from '../lib/utils';

export function useAppVersion(): string | undefined {
  const [version, setVersion] = useState<string | undefined>(undefined);

  useEffect(() => {
    const platform = detectPlatform();

    // Web and Electron use the build-time version
    // Only iOS and Android use the native Capacitor App API
    if (platform === 'web' || platform === 'electron') {
      setVersion(__APP_VERSION__);
    } else {
      App.getInfo().then((info) => {
        setVersion(info.build);
      });
    }
  }, []);

  return version;
}
