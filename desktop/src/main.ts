import { app, BrowserWindow, Menu, shell } from 'electron';
import { join, resolve } from 'node:path';
import { listenServer } from '../../server/src/app.ts';

// Electronはサーバーを起動して、その画面を窓で開くだけにする
const PORT = 47823;

let win: BrowserWindow | null = null;
let serverUrl = '';

// 投稿サイトの「アプリで開く」は archsage://open?post=…&ticket=… で届く。
// リンクはどのサイトでも作れるので、番号の形だけ確かめて「開く」画面に渡し、取り込むかは画面で聞く
const PROTOCOL = 'archsage';
function openPath(link: string | undefined): string | undefined {
  if (!link?.startsWith(`${PROTOCOL}://`)) return undefined;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return undefined;
  }
  const post = u.searchParams.get('post') ?? '';
  const ticket = u.searchParams.get('ticket');
  if (u.hostname !== 'open' || !/^[a-z0-9]{1,32}$/.test(post) || (ticket !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(ticket))) return undefined;
  const q = new URLSearchParams({ post, ...(ticket ? { ticket } : {}) });
  return `/open?${q}`;
}
const linkIn = (argv: string[]) => openPath(argv.find((a) => a.startsWith(`${PROTOCOL}://`)));

// electron . で動かしているときは、このフォルダを引数に付けて登録する
if (process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1] ?? '.')]);
else app.setAsDefaultProtocolClient(PROTOCOL);

async function start(): Promise<void> {
  const dataDir = process.env.ARCHSAGE_DATA_DIR ?? join(app.getPath('userData'), 'data');
  const server = await listenServer({
    port: PORT,
    paths: { dataDir, webDir: join(__dirname, 'web'), assetsDir: join(__dirname, 'assets') },
  });

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'Archsage',
    icon: join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  // 外のリンクと、サイトとつなぐ手続き（/site/ の下）は、いつものブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(server.url) || url.startsWith(`${server.url}/site/`)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(server.url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'ファイル',
        submenu: [{ label: 'データフォルダを開く', click: () => void shell.openPath(dataDir) }, { type: 'separator' }, { role: 'quit', label: '終了' }],
      },
      {
        label: '表示',
        submenu: [
          { role: 'reload', label: '再読み込み' },
          { role: 'toggleDevTools', label: '開発者ツール' },
          { type: 'separator' },
          { role: 'resetZoom', label: '元の大きさ' },
          { role: 'zoomIn', label: '拡大' },
          { role: 'zoomOut', label: '縮小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全画面' },
        ],
      },
    ]),
  );

  serverUrl = server.url;
  await win.loadURL(server.url + (linkIn(process.argv) ?? ''));
  win.on('closed', () => {
    win = null;
  });
  app.on('before-quit', () => {
    server.close();
    server.db.close();
  });
}

const single = app.requestSingleInstanceLock();
if (!single) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      const path = linkIn(argv);
      if (path && serverUrl) void win.loadURL(serverUrl + path);
    }
  });
  app.whenReady().then(start, (e) => {
    console.error(e);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
