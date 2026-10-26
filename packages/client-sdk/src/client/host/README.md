# Host contracts

Interfaces the SDK defines and the embedding application implements. The host
is the application that runs `new Tearleads(options)`: `packages/app` in its
web, Capacitor, or Electrobun shell, or any other app built on the SDK. Each
interface here is a port: the SDK owns the contract and the host supplies the
adapter.

| Contract | How the host supplies it | Who calls it |
| --- | --- | --- |
| `Logger` (`logger.ts`) | `new Tearleads({ logger })`. Without one, `log` is a no-op and `logError` writes to the console through `logErrorToConsole`. | The SDK, for diagnostics |
| `FileSaver` (`fileSaver.ts`) | The app's `AppHostConfig` carries one per shell: the web shell clicks a hidden download link, Capacitor writes the file and opens the share sheet, and Electrobun writes to the Downloads folder. | The app's download actions. The SDK only defines the contract, so it stays React-free and every shell can implement it. |

A contract that one facade consumes stays beside that facade instead:

- `NetworkStatusSource` with `Network` in `../runtime/network.ts`
- `BlobStoreFactory` with `Blobs` in `../blobs/index.ts`
- `PrincipalHistoryKeyProvider` with principal history custody in
  `../runtime/principalHistoryProtection.ts`

Add a contract here only when no single facade owns it. See
[client SDK seams](../../../../../docs/developer/client-sdk-seams.md) for how
ports and adapters are named and wired.
