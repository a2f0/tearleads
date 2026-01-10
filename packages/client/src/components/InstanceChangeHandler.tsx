/**
 * Root-level component that handles cleanup when switching between instances.
 * This component subscribes to instance change events and resets global state
 * that would otherwise persist incorrectly across instances.
 */

import { useCallback } from 'react';
import { useOnInstanceChange } from '@/hooks/useInstanceChange';
import { resetLLMUIState } from '@/hooks/useLLM';
import { clearAttachedImage } from '@/lib/llm-runtime';

export function InstanceChangeHandler() {
  const handleInstanceChange = useCallback(
    (newId: string | null, prevId: string | null) => {
      // Only reset when actually switching from one instance to another
      if (prevId !== null && newId !== prevId) {
        // Reset LLM UI state (keeps model in memory for quick switching back)
        resetLLMUIState();

        // Clear any attached image from the chat
        clearAttachedImage();
      }
    },
    []
  );

  useOnInstanceChange(handleInstanceChange);

  // This component doesn't render anything
  return null;
}
