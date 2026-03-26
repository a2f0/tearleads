import { postPublicKey } from "../../api/routes/register";
import { useAddressBook } from "../../crypto/AddressBookProvider";
import { useCryptoSession } from "../../crypto/CryptoSessionProvider";
import { useDatabase } from "../../db/DatabaseProvider";
import { usePeerUserId } from "../pane/DualPaneProvider";
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
  const {
    signingKeyPair,
    encapsulationKeyPair,
    userId,
    isAuthenticated,
    generateKey,
    destroyKey,
    setUserId,
    loginWithChallenge,
  } = useCryptoSession();
  const { entries, importKey } = useAddressBook();
  const peerUserId = usePeerUserId();
  const isTerminated = status === "terminated";
  const hasPeerKey =
    peerUserId !== null && entries.some((e) => e.userId === peerUserId);

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
      {signingKeyPair && encapsulationKeyPair && !userId && (
        <MenuItem
          label="Upload Public Key"
          onClick={async () => {
            const response = await postPublicKey(
              signingKeyPair.signingPublicKey,
              encapsulationKeyPair.publicKey,
            );
            setUserId(response.userId);
            await loginWithChallenge(response.challenge);
            onClose();
          }}
        />
      )}
      {isAuthenticated && peerUserId && !hasPeerKey && (
        <MenuItem
          label="Import Peer Key"
          onClick={async () => {
            await importKey(peerUserId);
            onClose();
          }}
        />
      )}
    </Menu>
  );
}
