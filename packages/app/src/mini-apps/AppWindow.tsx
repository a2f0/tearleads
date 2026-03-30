import type { ComponentType, PropsWithChildren } from "react";

interface AppWindowProps extends PropsWithChildren {
  Provider?: ComponentType<PropsWithChildren>;
}

export function AppWindow({ children, Provider }: AppWindowProps) {
  if (!Provider) {
    return children;
  }

  return <Provider>{children}</Provider>;
}
