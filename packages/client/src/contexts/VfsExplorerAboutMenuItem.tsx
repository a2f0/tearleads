import vfsExplorerPackageJson from '@tearleads/vfs-explorer/package.json';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';

export function VfsExplorerAboutMenuItem() {
  return (
    <AboutMenuItem
      appName="VFS Explorer"
      version={vfsExplorerPackageJson.version}
    />
  );
}
