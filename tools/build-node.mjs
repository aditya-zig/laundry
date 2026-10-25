import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function writeNodePackage(directory) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = process.argv[2];
  if (!['api', 'worker'].includes(app)) throw new Error('Choose api or worker compiled output');
  await writeNodePackage(fileURLToPath(new URL(`../apps/${app}/dist/`, import.meta.url)));
}
