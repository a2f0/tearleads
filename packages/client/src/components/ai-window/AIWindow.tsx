/**
 * Client wrapper for the @tearleads/ai AIWindow component.
 * Provides the ClientAIProvider context with all dependencies.
 */

import { AIWindow as AIWindowBase, type AIWindowProps } from '@tearleads/ai';
import {
  DesktopFloatingWindow as FloatingWindow,
  WindowControlBar
} from '@tearleads/window-manager';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ClientAIProvider } from '@/contexts/ClientAIProvider';
import { ModelsContent } from '@/pages/models/ModelsContent';

export function AIWindow(props: AIWindowProps) {
  const [showModels, setShowModels] = useState(false);

  const handleNavigateToModels = useCallback(() => {
    setShowModels(true);
  }, []);

  const handleBackToChat = useCallback(() => {
    setShowModels(false);
  }, []);

  // If showing models, render the models view
  if (showModels) {
    return (
      <ClientAIProvider navigateToModels={handleNavigateToModels}>
        <ModelsOverlayWindow {...props} onBack={handleBackToChat} />
      </ClientAIProvider>
    );
  }

  return (
    <ClientAIProvider navigateToModels={handleNavigateToModels}>
      <AIWindowBase {...props} />
    </ClientAIProvider>
  );
}

interface ModelsOverlayWindowProps extends AIWindowProps {
  onBack: () => void;
}

/**
 * A temporary overlay that shows the models content within the AI window.
 * This replicates the inline models view from the original ChatWindow.
 */
function ModelsOverlayWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions,
  onBack
}: ModelsOverlayWindowProps) {
  return (
    <FloatingWindow
      id={id}
      title="AI - Models"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions !== undefined && { initialDimensions })}
      defaultWidth={700}
      defaultHeight={550}
      minWidth={500}
      minHeight={400}
    >
      <div className="flex h-full flex-col">
        <WindowControlBar>{null}</WindowControlBar>
        <div className="border-b bg-muted/30 px-2 py-1">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to AI
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <ModelsContent showBackLink={false} />
        </div>
      </div>
    </FloatingWindow>
  );
}
