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
  const { killWorker, spawnWorker, status } = useDatabase();
  const isTerminated = status === "terminated";

  return (
    <Menu position={position} onClose={onClose}>
      {!isTerminated && (
        <MenuItem
          label="Kill Worker"
          onClick={() => {
            killWorker();
            onClose();
          }}
        />
      )}
      {isTerminated && (
        <MenuItem
          label="Spawn Worker"
          onClick={() => {
            spawnWorker();
            onClose();
          }}
        />
      )}
    </Menu>
  );
}
