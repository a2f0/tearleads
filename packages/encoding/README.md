# @tearleads/encoding

Dependency-free byte encoding helpers shared by the client and server
packages. It is a leaf package: it imports no other workspace package.

| Export | Use for |
| --- | --- |
| `bytesToBase64` | Encode a `Uint8Array` as standard base64 |
| `base64ToBytes` | Decode standard base64 back into a `Uint8Array` |

Keep additions small, synchronous, and free of runtime dependencies so every
package, including `@tearleads/crypto` and `@tearleads/validators`, can import
them.

## Tests

```sh
bun run --cwd packages/encoding test
```
