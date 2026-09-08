# Loro support

`@tearleads/loro/bun-plugin` exports `loroWasmPlugin` for Bun build scripts.
It resolves Loro to its supported base64 entrypoint, embedding WASM and its
JavaScript glue in the resulting bundle or standalone executable. Use it for
browser builds and `Bun.build({ compile: ... })` builds so deployment does not
require files from `node_modules`. Runtime consumers continue to import the
regular `@tearleads/loro` entrypoints.
