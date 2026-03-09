import type { ReactNode } from 'react';

export function highlightText(text: string, searchTerm: string): ReactNode {
  if (!searchTerm.trim()) {
    return text;
  }

  const searchLower = searchTerm.toLowerCase();
  const textLower = text.toLowerCase();
  const index = textLower.indexOf(searchLower);

  if (index === -1) {
    return text;
  }

  const before = text.slice(0, index);
  const match = text.slice(index, index + searchTerm.length);
  const after = text.slice(index + searchTerm.length);

  return (
    <>
      {before}
      <mark className="bg-warning text-warning-foreground">{match}</mark>
      {after}
    </>
  );
}
