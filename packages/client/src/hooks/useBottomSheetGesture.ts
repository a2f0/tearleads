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
  handleRef: React.RefObject<HTMLButtonElement | null>;
  isAnimating: boolean;
  snapTo: (snapPointName: string) => void;
}

const ANIMATION_DURATION = 300;
const DEFAULT_VELOCITY_THRESHOLD = 0.5;
const DEFAULT_DISMISS_THRESHOLD = 100;

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

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const startHeightRef = useRef(height);
  const currentHeightRef = useRef(height);

  const getMaxHeight = useCallback(() => {
    return window.innerHeight * maxHeightPercent;
  }, [maxHeightPercent]);

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
          sortedSnapPoints.find((sp) => sp.height > currentHeight + 10) ??
          sortedSnapPoints[sortedSnapPoints.length - 1] ??
          null
        );
      } else {
        return (
          [...sortedSnapPoints]
            .reverse()
            .find((sp) => sp.height < currentHeight - 10) ?? null
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

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    const gesture = createGesture({
      el: handle,
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
          } else if (direction === 'down' && onDismiss) {
            onDismiss();
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
