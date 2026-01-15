import { createGesture, type Gesture } from '@ionic/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SnapPoint {
  name: string;
  height: number;
}

interface UseBottomSheetGestureOptions {
  snapPoints: SnapPoint[];
  initialSnapPoint: string;
  minHeight: number;
  maxHeightPercent: number;
  onDismiss?: () => void;
  dismissThreshold?: number;
  velocityThreshold?: number;
}

interface UseBottomSheetGestureReturn {
  height: number;
  currentSnapPoint: string;
  sheetRef: React.RefObject<HTMLDivElement | null>;
  handleRef: (node: HTMLDivElement | null) => void;
  isAnimating: boolean;
  snapTo: (snapPointName: string) => void;
}

const ANIMATION_DURATION = 300;
const DEFAULT_VELOCITY_THRESHOLD = 0.5;
const DEFAULT_DISMISS_THRESHOLD = 100;
const SNAP_POINT_BIAS = 10;

export function setupResizeListener(
  onResize: (height: number) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleResize = () => {
    onResize(window.innerHeight);
  };

  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}

export function useBottomSheetGesture({
  snapPoints,
  initialSnapPoint,
  minHeight,
  maxHeightPercent,
  onDismiss,
  dismissThreshold = DEFAULT_DISMISS_THRESHOLD,
  velocityThreshold = DEFAULT_VELOCITY_THRESHOLD
}: UseBottomSheetGestureOptions): UseBottomSheetGestureReturn {
  const initialSnap = snapPoints.find((sp) => sp.name === initialSnapPoint);
  const defaultHeight = snapPoints[0]?.height ?? minHeight;
  const [height, setHeight] = useState(initialSnap?.height ?? defaultHeight);
  const [currentSnapPoint, setCurrentSnapPoint] = useState(initialSnapPoint);
  const [isAnimating, setIsAnimating] = useState(false);
  const [windowHeight, setWindowHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const startHeightRef = useRef(height);
  const currentHeightRef = useRef(height);

  // Use state to track handle element so effects re-run when it's attached
  const [handleElement, setHandleElement] = useState<HTMLDivElement | null>(
    null
  );
  const handleRef = useCallback((node: HTMLDivElement | null) => {
    setHandleElement(node);
  }, []);

  useEffect(() => {
    return setupResizeListener((height) => {
      setWindowHeight(height);
    });
  }, []);

  const getMaxHeight = useCallback(() => {
    return windowHeight * maxHeightPercent;
  }, [windowHeight, maxHeightPercent]);

  const findNearestSnapPoint = useCallback(
    (currentHeight: number): SnapPoint | null => {
      const maxHeight = getMaxHeight();
      const validSnapPoints = snapPoints.filter((sp) => sp.height <= maxHeight);

      const first = validSnapPoints[0];
      if (!first) return null;

      let nearest = first;
      let minDistance = Math.abs(currentHeight - nearest.height);

      for (const sp of validSnapPoints) {
        const distance = Math.abs(currentHeight - sp.height);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = sp;
        }
      }

      return nearest;
    },
    [snapPoints, getMaxHeight]
  );

  const findNextSnapPoint = useCallback(
    (currentHeight: number, direction: 'up' | 'down'): SnapPoint | null => {
      const maxHeight = getMaxHeight();
      const sortedSnapPoints = [...snapPoints]
        .filter((sp) => sp.height <= maxHeight)
        .sort((a, b) => a.height - b.height);

      if (sortedSnapPoints.length === 0) return null;

      if (direction === 'up') {
        return (
          sortedSnapPoints.find(
            (sp) => sp.height > currentHeight + SNAP_POINT_BIAS
          ) ??
          sortedSnapPoints[sortedSnapPoints.length - 1] ??
          null
        );
      } else {
        return (
          [...sortedSnapPoints]
            .reverse()
            .find((sp) => sp.height < currentHeight - SNAP_POINT_BIAS) ?? null
        );
      }
    },
    [snapPoints, getMaxHeight]
  );

  const animateToHeight = useCallback(
    (targetHeight: number, snapPointName: string) => {
      setIsAnimating(true);
      const startHeight = currentHeightRef.current;
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / ANIMATION_DURATION, 1);

        const easeOut = 1 - (1 - progress) ** 3;
        const newHeight = startHeight + (targetHeight - startHeight) * easeOut;

        setHeight(newHeight);
        currentHeightRef.current = newHeight;

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setHeight(targetHeight);
          currentHeightRef.current = targetHeight;
          setCurrentSnapPoint(snapPointName);
          setIsAnimating(false);
        }
      };

      requestAnimationFrame(animate);
    },
    []
  );

  const snapTo = useCallback(
    (snapPointName: string) => {
      const snapPoint = snapPoints.find((sp) => sp.name === snapPointName);
      if (snapPoint) {
        const maxHeight = getMaxHeight();
        const targetHeight = Math.min(snapPoint.height, maxHeight);
        animateToHeight(targetHeight, snapPointName);
      }
    },
    [snapPoints, getMaxHeight, animateToHeight]
  );

  // Set up Ionic gesture for touch events (mobile)
  useEffect(() => {
    if (!handleElement) return;

    const gesture = createGesture({
      el: handleElement,
      threshold: 0,
      gestureName: 'bottom-sheet-drag',
      direction: 'y',
      passive: false,

      onStart: () => {
        startHeightRef.current = currentHeightRef.current;
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
      },

      onMove: (detail) => {
        const delta = -detail.deltaY;
        const maxHeight = getMaxHeight();
        const newHeight = Math.min(
          maxHeight,
          Math.max(minHeight, startHeightRef.current + delta)
        );

        setHeight(newHeight);
        currentHeightRef.current = newHeight;
      },

      onEnd: (detail) => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        const velocityY = detail.velocityY;
        const currentHeight = currentHeightRef.current;
        const deltaY = detail.deltaY;

        if (velocityY > velocityThreshold || deltaY > dismissThreshold) {
          if (onDismiss) {
            onDismiss();
            return;
          }
        }

        if (Math.abs(velocityY) > velocityThreshold) {
          const direction = velocityY < 0 ? 'up' : 'down';
          const nextSnap = findNextSnapPoint(currentHeight, direction);

          if (nextSnap) {
            animateToHeight(nextSnap.height, nextSnap.name);
          } else {
            const nearest = findNearestSnapPoint(currentHeight);
            if (nearest) {
              animateToHeight(nearest.height, nearest.name);
            }
          }
        } else {
          const nearest = findNearestSnapPoint(currentHeight);
          if (nearest) {
            animateToHeight(nearest.height, nearest.name);
          }
        }
      }
    });

    gesture.enable();
    gestureRef.current = gesture;

    return () => {
      gesture.destroy();
      gestureRef.current = null;
    };
  }, [
    handleElement,
    minHeight,
    getMaxHeight,
    velocityThreshold,
    dismissThreshold,
    onDismiss,
    findNearestSnapPoint,
    findNextSnapPoint,
    animateToHeight
  ]);

  // Set up mouse event handlers for mouse drag (web/desktop)
  // Uses document-level listeners for move/up to ensure we capture events
  // even when the cursor moves outside the handle element during drag
  useEffect(() => {
    if (!handleElement) return;

    let startY = 0;
    let lastY = 0;
    let lastTime = 0;

    const handleMouseDown = (e: MouseEvent) => {
      // Prevent text selection and default behavior
      e.preventDefault();

      startY = e.clientY;
      lastY = e.clientY;
      lastTime = Date.now();
      startHeightRef.current = currentHeightRef.current;

      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';

      // Add document-level listeners for move and up
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - startY;
      const delta = -deltaY; // Invert: drag up = increase height
      const maxHeight = getMaxHeight();
      const newHeight = Math.min(
        maxHeight,
        Math.max(minHeight, startHeightRef.current + delta)
      );

      setHeight(newHeight);
      currentHeightRef.current = newHeight;

      lastY = e.clientY;
      lastTime = Date.now();
      e.preventDefault();
    };

    const handleMouseUp = (e: MouseEvent) => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Remove document-level listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // Calculate velocity
      const timeDelta = Date.now() - lastTime;
      const velocityY = timeDelta > 0 ? (e.clientY - lastY) / timeDelta : 0;
      const totalDeltaY = e.clientY - startY;
      const currentHeight = currentHeightRef.current;

      // Check for dismiss
      if (velocityY > velocityThreshold || totalDeltaY > dismissThreshold) {
        if (onDismiss) {
          onDismiss();
          return;
        }
      }

      const snapToNearest = () => {
        const nearest = findNearestSnapPoint(currentHeight);
        if (nearest) {
          animateToHeight(nearest.height, nearest.name);
        }
      };

      // Snap to appropriate point based on velocity
      if (Math.abs(velocityY) > velocityThreshold) {
        const direction = velocityY < 0 ? 'up' : 'down';
        const nextSnap = findNextSnapPoint(currentHeight, direction);

        if (nextSnap) {
          animateToHeight(nextSnap.height, nextSnap.name);
        } else {
          snapToNearest();
        }
      } else {
        snapToNearest();
      }

      e.preventDefault();
    };

    handleElement.addEventListener('mousedown', handleMouseDown);

    return () => {
      handleElement.removeEventListener('mousedown', handleMouseDown);
      // Cleanup document listeners if they're still attached
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    handleElement,
    minHeight,
    getMaxHeight,
    velocityThreshold,
    dismissThreshold,
    onDismiss,
    findNearestSnapPoint,
    findNextSnapPoint,
    animateToHeight
  ]);

  return {
    height,
    currentSnapPoint,
    sheetRef,
    handleRef,
    isAnimating,
    snapTo
  };
}
