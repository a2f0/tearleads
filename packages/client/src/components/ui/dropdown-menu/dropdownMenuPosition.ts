interface DropdownMenuPositionArgs {
  align: 'left' | 'right';
  rect: DOMRect;
}

export function getDropdownMenuPositionStyle({
  align,
  rect
}: DropdownMenuPositionArgs): React.CSSProperties {
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 2,
    visibility: 'visible'
  };

  if (align === 'right') {
    style.right = window.innerWidth - rect.right;
    return style;
  }

  style.left = rect.left;
  return style;
}
