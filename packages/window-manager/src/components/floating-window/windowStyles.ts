interface BuildFloatingWindowStylesOptions {
  isDesktop: boolean;
  isMaximized: boolean;
  isNearMaximized: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  zIndex: number;
  maxWidthPercent: number;
  maxHeightPercent: number;
}

export function buildFloatingWindowStyles({
  isDesktop,
  isMaximized,
  isNearMaximized,
  width,
  height,
  x,
  y,
  zIndex,
  maxWidthPercent,
  maxHeightPercent
}: BuildFloatingWindowStylesOptions): React.CSSProperties {
  if (isDesktop) {
    return {
      zIndex,
      width: `${width}px`,
      height: `${height}px`,
      left: `${x}px`,
      top: `${y}px`,
      ...(!isMaximized && !isNearMaximized
        ? {
            maxWidth: `${maxWidthPercent * 100}vw`,
            maxHeight: `${maxHeightPercent * 100}vh`
          }
        : {})
    };
  }

  return {
    zIndex,
    height: `${height}px`,
    maxHeight: `${maxHeightPercent * 100}vh`
  };
}
