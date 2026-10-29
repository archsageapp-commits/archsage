import { serve } from '@hono/node-server';
import { join, resolve } from 'node:path';
import { createSiteApp } from './app.ts';
import { nodeBlobs, nodeDb } from './nodeStore.ts';

// 手元で動かす仮のサイト。仮のログインが使え、運営としても入れる。データは site/.data に置く
const port = Number(process.env.SITE_PORT ?? 8792);
const dir = resolve(process.env.SITE_DATA_DIR ?? join(import.meta.dirname, '..', '.data'));
const baseUrl = `http://127.0.0.1:${port}`;
const db = nodeDb(join(dir, 'site.db'));
const app = createSiteApp({ db, blobs: nodeBlobs(join(dir, 'blobs')), baseUrl, termsVersion: 2, devLogin: true, devAdmin: true });

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`仮の投稿サイト: ${baseUrl}`));
