import { useDatabase } from "../../db/DatabaseProvider";
import { Menu, type MenuPosition } from "./Menu";
import { MenuItem } from "./MenuItem";

export function PaneMenu({
  position,
  onClose,
}: {
  position: MenuPosition;
  onClose: () => void;
}) {
  const { killWorker, spawnWorker } = useDatabase();

  return (
    <Menu position={position} onClose={onClose}>
      <MenuItem
        label="Kill Worker"
        onClick={() => {
          killWorker();
          onClose();
        }}
      />
      <MenuItem
        label="Spawn Worker"
        onClick={() => {
          spawnWorker();
          onClose();
        }}
      />
    </Menu>
  );
}
