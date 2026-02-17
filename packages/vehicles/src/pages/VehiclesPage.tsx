import type { ReactNode } from 'react';

export interface VehiclesPageProps {
  backLink?: ReactNode;
  children?: ReactNode;
}

export function VehiclesPage({ backLink, children }: VehiclesPageProps) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 pb-4">
        {backLink}
        <h1 className="font-bold text-xl tracking-tight sm:text-2xl">
          Vehicles
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border p-3">
        {children}
      </div>
    </div>
  );
}
