// 配布物に入る部品のライセンス表記を THIRD_PARTY_NOTICES.txt にまとめる
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');

interface Pkg {
  name: string;
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readPkg(name: string): { pkg: Pkg; dir: string } | undefined {
  const dir = join(nm, name);
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return undefined;
  return { pkg: JSON.parse(readFileSync(file, 'utf8')) as Pkg, dir };
}

const seen = new Map<string, { pkg: Pkg; dir: string }>();
function walk(name: string): void {
  if (name.startsWith('@archsage/') || seen.has(name)) return;
  const found = readPkg(name);
  if (!found) return;
  seen.set(name, found);
  for (const dep of Object.keys(found.pkg.dependencies ?? {})) walk(dep);
}

for (const ws of ['server', 'web']) {
  const pkg = JSON.parse(readFileSync(join(root, ws, 'package.json'), 'utf8')) as Pkg;
  for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep);
}

const parts: string[] = [
  'Archsage に含まれる第三者のソフトウェア',
  'This application includes the following third-party software.',
  'Electron と Chromium のライセンスは、アプリのフォルダの LICENSE と LICENSES.chromium.html にあります。',
  '',
];
for (const [name, { pkg, dir }] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  const licFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\..*)?$/i.test(f));
  const text = licFile ? readFileSync(join(dir, licFile), 'utf8').trim() : `License: ${pkg.license ?? 'unknown'}`;
  parts.push('='.repeat(72), `${name} ${pkg.version} (${pkg.license ?? 'unknown'})`, '='.repeat(72), text, '');
}
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.txt'), parts.join('\n'));
console.log(`${seen.size}件の部品を THIRD_PARTY_NOTICES.txt にまとめました`);
