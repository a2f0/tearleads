import type { ReactNode } from 'react';

export interface BusinessesPageProps {
  backLink?: ReactNode;
  children?: ReactNode;
}

export function BusinessesPage({ backLink, children }: BusinessesPageProps) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 pb-4">
        {backLink}
        <h1 className="font-bold text-xl tracking-tight sm:text-2xl">
          Businesses
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border p-3">
        {children}
      </div>
    </div>
  );
}
