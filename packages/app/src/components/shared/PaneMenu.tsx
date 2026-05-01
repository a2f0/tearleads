import { useRegisterCurrentIdentity } from "../../identity/useRegisterCurrentIdentity";
import { useCryptoSession } from "../../providers/crypto/CryptoSessionProvider";
import { useDatabase } from "../../providers/db/DatabaseProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
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
    useIdentity();
  const { canRegisterCurrentIdentity, registerCurrentIdentity } =
    useRegisterCurrentIdentity();
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
        canRegisterCurrentIdentity && (
          <MenuItem
            label="Upload Public Key"
            onClick={async () => {
              onClose();
              if (!canRegisterCurrentIdentity) {
                return;
              }

              await registerCurrentIdentity();
            }}
          />
        )}
    </Menu>
  );
}
