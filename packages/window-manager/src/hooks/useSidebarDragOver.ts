import { useCallback, useRef, useState } from 'react';

export interface UseSidebarDragOverResult {
  dragOverId: string | null;
  handleDragEnter: (id: string) => void;
  handleDragLeave: (id: string) => void;
  clearDragState: (id: string) => void;
}

export function useSidebarDragOver(): UseSidebarDragOverResult {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragCounterRef = useRef<Record<string, number>>({});

  const handleDragEnter = useCallback((id: string) => {
    dragCounterRef.current[id] = (dragCounterRef.current[id] ?? 0) + 1;
    if (dragCounterRef.current[id] === 1) {
      setDragOverId(id);
    }
  }, []);

  const handleDragLeave = useCallback((id: string) => {
    dragCounterRef.current[id] = (dragCounterRef.current[id] ?? 0) - 1;
    if (dragCounterRef.current[id] <= 0) {
      dragCounterRef.current[id] = 0;
      setDragOverId((current) => (current === id ? null : current));
    }
  }, []);

  const clearDragState = useCallback((id: string) => {
    dragCounterRef.current[id] = 0;
    setDragOverId((current) => (current === id ? null : current));
  }, []);

  return {
    dragOverId,
    handleDragEnter,
    handleDragLeave,
    clearDragState
  };
}
