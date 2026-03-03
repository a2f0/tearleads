import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export function wasmGeneratedGuard(): Plugin {
  return {
    name: 'wasm-generated-guard',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url;
        if (!url) return next();

        const urlPath = url.split('?')[0] ?? '';
        if (!urlPath.includes('.generated/') || !urlPath.endsWith('.js')) {
          return next();
        }

        let fsPath: string;
        if (urlPath.startsWith('/@fs/')) {
          fsPath = urlPath.slice(4);
        } else {
          fsPath = resolve(server.config.root, urlPath.slice(1));
        }

        if (existsSync(fsPath)) {
          return next();
        }

        res.setHeader('Content-Type', 'application/javascript');
        res.statusCode = 200;
        res.end(
          `throw new Error('WASM bindings not found at ${urlPath}. Run: pnpm codegenWasm');`
        );
      });
    }
  };
}
