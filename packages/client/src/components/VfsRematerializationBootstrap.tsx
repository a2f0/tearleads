import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useVfsOrchestrator } from '@/contexts/VfsOrchestratorContext';
import { rematerializeRemoteVfsStateIfNeeded } from '@/lib/vfsRematerialization';

export function VfsRematerializationBootstrap() {
  const { isAuthenticated } = useAuth();
  const { isReady } = useVfsOrchestrator();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !isReady || attemptedRef.current) {
      return;
    }
    attemptedRef.current = true;
    void rematerializeRemoteVfsStateIfNeeded().catch((error) => {
      console.warn('VFS rematerialization bootstrap failed:', error);
    });
  }, [isAuthenticated, isReady]);

  return null;
}
