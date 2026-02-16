import { useEffect, useState } from 'react';

const SMALL_TILE_SIZE_PX = 100;
const LARGE_TILE_SIZE_PX = 200;
const BREAKPOINT_QUERY = '(min-width: 768px)';

function getInitialTileSize() {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return SMALL_TILE_SIZE_PX;
  }
  return window.matchMedia(BREAKPOINT_QUERY).matches
    ? LARGE_TILE_SIZE_PX
    : SMALL_TILE_SIZE_PX;
}

export function useSelectorTileSize() {
  const [tileSize, setTileSize] = useState(getInitialTileSize);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return undefined;
    }

    const mediaQuery = window.matchMedia(BREAKPOINT_QUERY);
    const updateSize = () => {
      setTileSize(mediaQuery.matches ? LARGE_TILE_SIZE_PX : SMALL_TILE_SIZE_PX);
    };

    updateSize();
    mediaQuery.addEventListener('change', updateSize);
    return () => {
      mediaQuery.removeEventListener('change', updateSize);
    };
  }, []);

  return tileSize;
}
