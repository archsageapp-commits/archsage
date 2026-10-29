// Electron用にまとめる。メインとサーバーを1つのファイルにし、画面と同梱物をそばに置く
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(here, 'src', 'main.ts')],
  outfile: join(out, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
});

const web = join(root, 'web', 'dist');
if (!existsSync(join(web, 'index.html'))) throw new Error('画面がビルドされていません。先に npm run build -w web を実行してください');
cpSync(web, join(out, 'web'), { recursive: true });
cpSync(join(root, 'assets'), join(out, 'assets'), { recursive: true });
if (existsSync(join(here, 'icon.png'))) cpSync(join(here, 'icon.png'), join(out, 'icon.png'));
console.log('desktop/dist にまとめました');
