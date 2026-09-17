import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePdfAssetPath(
  packageDir: string | undefined,
  assetPath: string,
  moduleUrl: string,
): string {
  const relativePath = `node_modules/pdfjs-dist/${assetPath}`;
  if (packageDir) return resolve(packageDir, relativePath);
  return fileURLToPath(new URL(`../../${relativePath}`, moduleUrl));
}
