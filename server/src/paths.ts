import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export interface AppPaths {
  dataDir: string; // app.db と images/。バックアップはこのフォルダをコピーするだけ
  webDir: string; // 画面のビルド結果
  assetsDir: string; // 同梱のワークフローなど
}

// リポジトリから直接動かすときの置き場所。Electronでは呼ばずに paths を渡す
// import.meta を使うので、Electron用にまとめるファイル（CommonJS）からは読み込まない
export function defaultPaths(): AppPaths {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  return {
    dataDir: process.env.ARCHSAGE_DATA_DIR ?? join(root, 'data'),
    webDir: process.env.ARCHSAGE_WEB_DIR ?? join(root, 'web', 'dist'),
    assetsDir: process.env.ARCHSAGE_ASSETS_DIR ?? join(root, 'assets'),
  };
}
