import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFiles = ['root.env', 'staging.env', 'prod.env', 'dev.env'];

export function sortSecrets(secretsDir: string): void {
  for (const file of envFiles) {
    const target = resolve(secretsDir, file);
    if (!existsSync(target)) {
      process.stderr.write(`warning: ${target} not found, skipping\n`);
      continue;
    }

    const lines = readFileSync(target, 'utf8').split('\n');

    // Remove trailing empty element from final newline
    if (lines.at(-1) === '') {
      lines.pop();
    }

    lines.sort((a, b) => {
      // LC_ALL=C byte-order comparison
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    writeFileSync(target, `${lines.join('\n')}\n`);
  }
}
