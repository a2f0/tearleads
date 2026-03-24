import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
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
  const { keyPair, generateKey, destroyKey } = useCryptoSession();
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
      {!keyPair && (
        <MenuItem
          label="Generate Key Pair"
          onClick={() => {
            generateKey();
            onClose();
          }}
        />
      )}
      {keyPair && (
        <MenuItem
          label="Destroy Key Pair"
          onClick={() => {
            destroyKey();
            onClose();
          }}
        />
      )}
    </Menu>
  );
}
