import {
  DesktopContextMenu,
  DesktopContextMenuItem,
  WindowConnectionIndicator
} from '@tearleads/window-manager';
import { Info } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SSEConnectionDialog } from '../components/SSEConnectionDialog';
import { useOptionalAuth } from '../contexts/AuthContext';
import { useSSEContext } from '../sse';

const sseTooltipKeys = {
  connected: 'sseConnected',
  connecting: 'sseConnecting',
  disconnected: 'sseDisconnected'
} as const;

export function SSESystemTrayItems() {
  const { t } = useTranslation('tooltips');
  const auth = useOptionalAuth();
  const isAuthenticated = auth?.isAuthenticated ?? false;
  const sse = useSSEContext();
  const [sseContextMenu, setSseContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isSseDialogOpen, setIsSseDialogOpen] = useState(false);

  const handleSseContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      setSseContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleCloseSseContextMenu = useCallback(() => {
    setSseContextMenu(null);
  }, []);

  const handleShowConnectionDetails = useCallback(() => {
    setIsSseDialogOpen(true);
    setSseContextMenu(null);
  }, []);

  const handleCloseSseDialog = useCallback(() => {
    setIsSseDialogOpen(false);
  }, []);

  if (!isAuthenticated || !sse) {
    return null;
  }

  return (
    <>
      <WindowConnectionIndicator
        state={sse.connectionState}
        tooltip={t(sseTooltipKeys[sse.connectionState])}
        onClick={handleShowConnectionDetails}
        onContextMenu={handleSseContextMenu}
      />
      {sseContextMenu && (
        <DesktopContextMenu
          x={sseContextMenu.x}
          y={sseContextMenu.y}
          onClose={handleCloseSseContextMenu}
        >
          <DesktopContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={handleShowConnectionDetails}
          >
            Connection Details
          </DesktopContextMenuItem>
        </DesktopContextMenu>
      )}
      <SSEConnectionDialog
        isOpen={isSseDialogOpen}
        onClose={handleCloseSseDialog}
        connectionState={sse.connectionState}
      />
    </>
  );
}
