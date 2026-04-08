import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import { usePersona } from "../../persona/PersonaProvider";
import { useRegisterCurrentPersona } from "../../persona/useRegisterCurrentPersona";
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
  const { userId } = useCryptoSession();
  const { destroyKey, encapsulationKeyPair, generateKey, signingKeyPair } =
    usePersona();
  const { canRegisterCurrentPersona, registerCurrentPersona } =
    useRegisterCurrentPersona();
  const isTerminated = status === "terminated";

  return (
    <Menu position={position} onClose={onClose}>
      {signingKeyPair && !isTerminated && (
        <MenuItem
          label="Kill Worker"
          onClick={() => {
            killWorker();
            onClose();
          }}
        />
      )}
      {signingKeyPair && isTerminated && (
        <MenuItem
          label="Spawn Worker"
          onClick={() => {
            spawnWorker();
            onClose();
          }}
        />
      )}
      {!signingKeyPair && (
        <MenuItem
          label="Generate Key Pair"
          onClick={() => {
            generateKey();
            onClose();
          }}
        />
      )}
      {signingKeyPair && (
        <MenuItem
          label="Destroy Key Pair"
          onClick={() => {
            destroyKey();
            onClose();
          }}
        />
      )}
      {signingKeyPair &&
        encapsulationKeyPair &&
        !userId &&
        canRegisterCurrentPersona && (
          <MenuItem
            label="Upload Public Key"
            onClick={async () => {
              onClose();
              if (!canRegisterCurrentPersona) {
                return;
              }

              await registerCurrentPersona();
            }}
          />
        )}
    </Menu>
  );
}
