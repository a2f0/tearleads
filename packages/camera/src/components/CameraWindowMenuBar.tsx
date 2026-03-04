import cameraPackageJson from '@tearleads/camera/package.json';
import { AboutMenuItem, DropdownMenu, DropdownMenuItem } from '@tearleads/ui';
import { WindowMenuBar } from '@tearleads/window-manager';

interface CameraWindowMenuBarProps {
  onClose: () => void;
}

export function CameraWindowMenuBar({ onClose }: CameraWindowMenuBarProps) {
  return (
    <WindowMenuBar>
      <DropdownMenu trigger="File">
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem
          appName="Camera"
          version={cameraPackageJson.version}
          closeLabel="Close"
        />
      </DropdownMenu>
    </WindowMenuBar>
  );
}
