import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { BUNDLE_LIMITS, BUNDLE_VERSION, newId, normalizeLorebook, type BundleJson } from '@archsage/shared';
import type { Blobs, Db } from './db.ts';
import { mountAdmin } from './admin.ts';
import { passthroughImages, type ImageProcessor } from './images.ts';
import { REPORT_KINDS } from './labels.ts';
import { GUIDELINES, PRIVACY, TERMS } from './legal.ts';
import { mountOAuth, oauthProviders, type OAuthOptions } from './oauth.ts';
import { hashtags, icon, layout, legalPage, listTabs, loreCard, message, pageHead, postCard, ratingBadge } from './pages.ts';
import { buildBundle, PostError, postRef, readLorebook, readPlot, savePost, withdrawPost, type PostKind, type PostMeta, type PostRow, type UserRow } from './posts.ts';
import { IMAGE_TYPES, imageKind, randomToken, safeNext, sha256 } from './util.ts';

export interface SiteOptions {
  db: Db;
  blobs: Blobs;
  baseUrl: string; // 例 https://scenario.example。投稿の印に入る
  termsVersion: number;
  devLogin?: boolean; // 開発用の仮のログイン。本番では切る
  devLoginKey?: string; // 仮のログインの合言葉。ネットに出すときは必ず付ける
  devAdmin?: boolean; // 仮のログインで運営として入れるようにする。手元だけで使う
  images?: ImageProcessor; // 投稿の画像の作り直し。省くと埋め込み情報を消すだけ
  oauth?: OAuthOptions; // Google と Discord のログイン。鍵があるものだけ出す
  now?: () => number;
}

export type Env = { Variables: { viewer: UserRow | null; appUser: UserRow; appTokenId: string } };

const SESSION_DAYS = 30;
const CODE_MINUTES = 5;
const TICKET_MINUTES = 5;
// アプリをつなぐときの戻り先は、利用者のPCの中のアプリだけ
const REDIRECT_URI = /^http:\/\/127\.0\.0\.1:\d{1,5}\/site\/callback$/;

export function createSiteApp(opts: SiteOptions) {
  const { db, blobs } = opts;
  const images = opts.images ?? passthroughImages;
  const now = opts.now ?? Date.now;
  const app = new Hono<Env>();
  const origin = new URL(opts.baseUrl).origin;

  const canSeeAdult = (u: UserRow | null) => !!u && !!u.adult && !!u.show_adult;
  const canSee = (u: UserRow | null, p: PostRow) => p.rating === 'all' || canSeeAdult(u);
  const authorName = async (id: string) => (await db.get<{ display_name: string }>('select display_name from users where id = ?', id))?.display_name ?? '';
  const postOf = (id: string) => db.get<PostRow>('select * from posts where id = ?', id);

  // ---- ログインの記録 ----
  app.use('*', async (c, next) => {
    const sid = getCookie(c, 'sid');
    let viewer: UserRow | null = null;
    if (sid) {
      viewer = (await db.get<UserRow>('select u.* from sessions s join users u on u.id = s.user_id where s.id = ? and s.expires_at > ?', await sha256(sid), now())) ?? null;
    }
    c.set('viewer', viewer);
    // ブラウザからの書き込みは、このサイトのページからだけ受け付ける
    if (c.req.method !== 'GET' && !c.req.path.startsWith('/api/')) {
      const o = c.req.header('origin');
      if (o && o !== origin) return c.text('ほかのサイトからの送信は受け付けません', 403);
    }
    await next();
  });

  const startSession = async (c: Context<Env>, userId: string) => {
    const sid = randomToken();
    await db.run('insert into sessions (id, user_id, expires_at) values (?, ?, ?)', await sha256(sid), userId, now() + SESSION_DAYS * 864e5);
    setCookie(c, 'sid', sid, { httpOnly: true, sameSite: 'Lax', path: '/', secure: origin.startsWith('https:'), maxAge: SESSION_DAYS * 86400 });
  };

  const needLogin = (c: Context<Env>) => c.redirect(`/login?next=${encodeURIComponent(c.req.path + (new URL(c.req.url).search || ''))}`);

  // ---- 一覧 ----
  // シナリオと設定集は別の一覧。設定集だけでは遊べないので混ぜない
  const listPage = async (c: Context<Env>, kind: PostKind) => {
    const viewer = c.get('viewer');
    const q = (c.req.query('q') ?? '').trim().slice(0, 50);
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const rows = await db.all<PostRow & { author_name: string }>(
      `select p.*, u.display_name as author_name from posts p join users u on u.id = p.author_id
       where p.status = 'live' and p.visibility = 'public' and p.kind = ? and (p.rating = 'all' or ? = 1)
         and (? = '' or p.title like ? or p.tagline like ? or p.hashtags like ? or p.source_title like ?)
       order by p.updated_at desc limit 60`,
      kind,
      canSeeAdult(viewer) ? 1 : 0,
      q,
      like,
      like,
      like,
      like,
    );
    const lore = kind === 'lorebook';
    return c.html(
      layout(
        lore ? '設定集' : '一覧',
        viewer,
        html`${lore
            ? pageHead('設定集を探す', '世界観や用語などをまとめた設定集です。アプリに取り込み、シナリオの編集画面の「設定集」タブで選ぶと、会話に使われます')
            : pageHead('シナリオを探す', 'Archsage のアプリで遊べるシナリオです。気になるものを開いて「アプリで開く」を押すと、アプリに取り込めます')}
          ${listTabs(kind, q)}
          <form method="get" action="${lore ? '/lorebooks' : '/'}" class="search">
            <input name="q" value="${q}" placeholder="題名、タグ、元作品名で探す" />
            <button class="btn btn-primary">${icon('search')}探す</button>
          </form>
          ${q ? html`<p class="faint" style="margin-bottom:12px">「${q}」の結果 ${rows.length}件</p>` : ''}
          ${rows.length
            ? lore
              ? html`<div class="lore-grid">${rows.map((p) => loreCard(p))}</div>`
              : html`<div class="grid">${rows.map((p) => postCard(p))}</div>`
            : html`<div class="empty">${q ? '見つかりませんでした' : lore ? 'まだ設定集がありません' : 'まだシナリオがありません'}</div>`}`,
      ),
    );
  };
  app.get('/', (c) => listPage(c, 'plot'));
  app.get('/lorebooks', (c) => listPage(c, 'lorebook'));

  // ---- シナリオのページ ----
  app.get('/s/:id', async (c) => {
    const viewer = c.get('viewer');
    const p = await postOf(c.req.param('id'));
    if (!p) return c.html(message('見つかりません', viewer, 'このシナリオはありません'), 404);
    if (p.status === 'withdrawn') return c.html(message(p.title, viewer, 'このシナリオは取り下げられました'), 410);
    const own = viewer?.id === p.author_id || !!viewer?.admin;
    if (p.status === 'hidden' && !own) return c.html(message('非公開', viewer, 'このシナリオは運営により非公開になっています'), 404);
    if (!canSee(viewer, p)) {
      return c.html(message('R-18の作品', viewer, 'ログインして「18歳以上」と答え、R-18の表示をオンにすると見られます', { href: viewer ? '/me' : `/login?next=/s/${p.id}`, label: viewer ? '設定を開く' : 'ログイン' }), 403);
    }
    // シナリオの中の {{user}} は利用者の名前に置き換わる。サイトでは「あなた」と見せる
    const show = (t: string) => t.replace(/\{\{user\}\}/g, 'あなた');
    const origin = p.origin_post_id ? await postOf(p.origin_post_id) : undefined;
    const author = await authorName(p.author_id);
    const what = p.kind === 'lorebook' ? '設定集' : 'シナリオ';
    const head = (l: { tagline: string; hashtags: string[] }) => html`<div>
      <div class="row" style="margin-bottom:8px">${p.kind === 'lorebook' ? html`<span class="badge badge-gold">設定集</span>` : ''}${ratingBadge(p.rating)}${hashtags(l.hashtags)}</div>
      <h1 class="post-title">${p.title}</h1>
      ${l.tagline ? html`<p style="margin-top:8px;font-size:15px">${l.tagline}</p>` : ''}
      <p class="faint" style="margin-top:8px">
        作者: ${author}${p.source_title ? html` ・ 元作品: ${p.source_title}` : ''}
        ${origin ? html` ・ 元の${what}: ${origin.status === 'withdrawn' ? `元の${what}は取り下げられました` : html`<a href="/s/${origin.id}">${origin.title}</a>`}` : ''}
      </p>
    </div>`;
    const about = (l: { intro: string; creatorComment: string }) =>
      l.intro || l.creatorComment
        ? html`<div class="card">
            ${l.intro ? html`<p class="prose">${show(l.intro)}</p>` : ''}
            ${l.creatorComment ? html`<div style="margin-top:12px"><div class="faint">作者コメント</div><p class="prose muted" style="font-size:13.5px">${l.creatorComment}</p></div>` : ''}
          </div>`
        : '';
    const side = (body: unknown) => html`<aside class="stack">
      ${body}
      <div class="card stack">
        <a class="btn btn-primary btn-block" href="/s/${p.id}/open">${icon('play')}アプリで開く</a>
        <a class="btn btn-subtle btn-block btn-sm" href="/s/${p.id}/download">${icon('download')}開かないときは zip をダウンロード</a>
        <p class="faint">アプリで開いた回数: ${p.opens}</p>
      </div>
      <a class="btn btn-ghost btn-sm" href="/s/${p.id}/report">${icon('flag')}問題を報告</a>
      ${viewer?.admin && p.status === 'live'
        ? html`<form method="post" action="/admin/posts/${p.id}/hide" class="card stack">
            <div class="faint">運営</div>
            <input name="reason" placeholder="非公開にする理由（作者に見えます）" required />
            <button class="btn btn-danger btn-sm">非公開にする</button>
          </form>`
        : ''}
    </aside>`;
    const hiddenNote = p.status === 'hidden' ? html`<div class="notice notice-danger" style="margin-bottom:16px">運営が非公開にしました。理由: ${p.hidden_reason ?? ''}</div>` : '';

    // 設定集は中身（項目のキーワードと本文）をそのまま見せる
    if (p.kind === 'lorebook') {
      const lore = await readLorebook(blobs, p.id);
      if (!lore) return c.html(message('読めません', viewer, 'この設定集の中身を読めませんでした'), 500);
      const book = normalizeLorebook(lore.lorebook);
      return c.html(
        layout(
          p.title,
          viewer,
          html`${hiddenNote}
            <div class="layout-2">
              <div class="stack">
                ${head(book.listing!)} ${about(book.listing!)}
                <section class="section"><h2>項目（${book.entries.length}）</h2>
                  <div class="card">
                    ${book.entries.map(
                      (e, i) => html`<div class="entry">
                        <div class="entry-head">
                          <span style="font-weight:600">${e.comment?.trim() || `項目${i + 1}`}</span>
                          ${e.constant ? html`<span class="badge badge-gold">常に入れる</span>` : e.keys.map((k) => html`<span class="chip">${k}</span>`)}
                          ${e.enabled ? '' : html`<span class="badge">使わない</span>`}
                        </div>
                        <p class="prose muted" style="font-size:13.5px">${show(e.content)}</p>
                      </div>`,
                    )}
                  </div>
                </section>
              </div>
              ${side(html`<div class="card"><p class="faint">設定集だけでは遊べません。アプリに取り込んだら、シナリオの編集画面の「設定集」タブで選ぶと、会話に使われます。</p></div>`)}
            </div>`,
        ),
      );
    }

    const json = await readPlot(blobs, p.id);
    if (!json) return c.html(message('読めません', viewer, 'このシナリオの中身を読めませんでした'), 500);
    const plot = json.plot;
    return c.html(
      layout(
        p.title,
        viewer,
        html`${hiddenNote}
          <div class="layout-2">
            <div class="stack">
              ${head(plot.listing)} ${about(plot.listing)}
              <section class="section"><h2>キャラクター</h2>
                <div class="card">
                  ${plot.characters.map(
                    (ch, i) => html`<div class="char">
                      ${ch.avatar ? html`<img class="avatar" src="/s/${p.id}/avatar/${i}" alt="" />` : html`<div class="avatar">${ch.name.slice(0, 1)}</div>`}
                      <div style="min-width:0"><div style="font-weight:600">${ch.name}</div><p class="prose muted" style="font-size:13.5px">${show(ch.profile)}</p></div>
                    </div>`,
                  )}
                </div>
              </section>
              <section class="section"><h2>世界観</h2><div class="card"><p class="prose">${show(plot.story)}</p></div></section>
              <section class="section"><h2>導入</h2>${plot.intros.map((it, i) => html`<div class="card">${plot.intros.length > 1 ? html`<div class="faint" style="margin-bottom:4px">導入${i + 1}</div>` : ''}<p class="prose">${show(it.text)}</p></div>`)}</section>
            </div>
            ${side(html`<div class="cover" style="border-radius:12px;border:1px solid var(--line)">${plot.listing.cover ? html`<img src="/s/${p.id}/cover" alt="" />` : icon('image')}</div>`)}
          </div>`,
      ),
    );
  });

  const visibleImage = async (c: Context<Env>, path: (json: BundleJson) => string | undefined) => {
    const p = await postOf(c.req.param('id') ?? '');
    const viewer = c.get('viewer');
    if (!p || p.status === 'withdrawn' || (p.status === 'hidden' && viewer?.id !== p.author_id && !viewer?.admin) || !canSee(viewer, p)) return c.notFound();
    const json = await readPlot(blobs, p.id);
    const rel = json ? path(json) : undefined;
    const data = rel ? await blobs.get(`posts/${p.id}/${rel}`) : undefined;
    const kind = data ? imageKind(data) : undefined;
    if (!data || !kind) return c.notFound();
    return c.body(data as Uint8Array<ArrayBuffer>, 200, { 'content-type': IMAGE_TYPES[kind], 'cache-control': p.rating === 'all' ? 'public, max-age=300' : 'private, max-age=300' });
  };
  app.get('/s/:id/cover', (c) => visibleImage(c, (j) => j.plot.listing.cover));
  app.get('/s/:id/avatar/:i', (c) => visibleImage(c, (j) => j.plot.characters[Number(c.req.param('i'))]?.avatar));

  // 全年齢はそのまま、R-18は確認を通った人にだけ、1回だけ使える引換券を付けてアプリに渡す
  app.get('/s/:id/open', async (c) => {
    const viewer = c.get('viewer');
    const p = await postOf(c.req.param('id'));
    if (!p || p.status !== 'live') return c.html(message('開けません', viewer, 'このシナリオは公開されていません'), 404);
    if (p.rating === 'all') return c.redirect(`archsage://open?post=${p.id}`);
    if (!canSeeAdult(viewer)) return needLogin(c);
    const ticket = randomToken();
    await db.run('insert into tickets (id, post_id, user_id, expires_at) values (?, ?, ?, ?)', await sha256(ticket), p.id, viewer!.id, now() + TICKET_MINUTES * 6e4);
    return c.redirect(`archsage://open?post=${p.id}&ticket=${ticket}`);
  });

  // ブラウザにはログインの記録があるので、引換券は使わずページと同じ確認で渡す
  app.get('/s/:id/download', async (c) => {
    const viewer = c.get('viewer');
    const p = await postOf(c.req.param('id'));
    if (!p || p.status !== 'live') return c.html(message('ダウンロードできません', viewer, 'このシナリオは公開されていません'), 404);
    if (!canSee(viewer, p)) return needLogin(c);
    const zip = await buildBundle(blobs, p, postRef(opts.baseUrl, p, await authorName(p.author_id)));
    if (!zip) return c.notFound();
    return c.body(zip as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${p.title}.zip`)}` });
  });

  // ---- 通報と削除の申し立て ----
  app.get('/s/:id/report', async (c) => {
    const p = await postOf(c.req.param('id'));
    if (!p) return c.notFound();
    return c.html(
      layout(
        '問題を報告',
        c.get('viewer'),
        html`<div style="max-width:640px;margin:0 auto">
          ${pageHead('問題を報告', html`対象: <a href="/s/${p.id}">${p.title}</a>。7日以内をめどに確かめます`)}
          <form method="post" class="card stack">
            <div class="field"><span>種類</span>
              <div class="choice-list">${Object.entries(REPORT_KINDS).map(([k, label], i) => html`<label><input type="radio" name="kind" value="${k}" ${i === 0 ? 'checked' : ''} /> ${label}</label>`)}</div>
            </div>
            <label class="field"><span>どこが問題か</span><textarea name="detail" rows="5" required></textarea></label>
            <label class="field"><span>連絡先</span><input name="contact" placeholder="メールアドレスなど" /><small>権利の侵害の報告では必須です</small></label>
            <div><button class="btn btn-primary">送る</button></div>
          </form>
        </div>`,
      ),
    );
  });
  app.post('/s/:id/report', async (c) => {
    const p = await postOf(c.req.param('id'));
    if (!p) return c.notFound();
    const body = await c.req.parseBody();
    const kind = String(body.kind ?? 'other');
    const detail = String(body.detail ?? '').slice(0, 5000);
    const contact = String(body.contact ?? '').slice(0, 200);
    if (!(kind in REPORT_KINDS) || !detail.trim()) return c.html(message('送れません', c.get('viewer'), '種類と内容を入れてください'), 400);
    if (kind === 'rights' && !contact.trim()) return c.html(message('送れません', c.get('viewer'), '権利の侵害の報告には連絡先が要ります'), 400);
    await db.run('insert into reports (id, post_id, kind, detail, contact, created_at) values (?, ?, ?, ?, ?, ?)', newId(), p.id, kind, detail, contact || null, now());
    return c.html(message('受け付けました', c.get('viewer'), '報告を受け付けました。7日以内をめどに確かめます', { href: `/s/${p.id}`, label: 'シナリオに戻る' }));
  });
  app.get('/takedown', (c) =>
    c.html(
      layout(
        '削除の申し立て',
        c.get('viewer'),
        html`<div style="max-width:640px;margin:0 auto">
          ${pageHead('権利者の方へ（削除の申し立て）', 'このサイトのシナリオがあなたの権利を侵していると思われるときは、こちらからお知らせください。7日以内をめどに確かめます')}
          <form method="post" class="card stack">
            <label class="field"><span>対象のシナリオのURL</span><input name="target" placeholder="https://…/s/…" required /></label>
            <label class="field"><span>権利の根拠</span><textarea name="detail" rows="5" placeholder="どの作品の、どの権利か" required></textarea></label>
            <label class="field"><span>連絡先</span><input name="contact" placeholder="メールアドレスなど" required /></label>
            <div><button class="btn btn-primary">送る</button></div>
          </form>
        </div>`,
      ),
    ),
  );
  app.post('/takedown', async (c) => {
    const body = await c.req.parseBody();
    const target = String(body.target ?? '').slice(0, 500);
    const detail = String(body.detail ?? '').slice(0, 5000);
    const contact = String(body.contact ?? '').slice(0, 200);
    if (!target.trim() || !detail.trim() || !contact.trim()) return c.html(message('送れません', c.get('viewer'), 'すべての欄を入れてください'), 400);
    const postId = /\/s\/([a-z0-9]+)/.exec(target)?.[1] ?? null;
    await db.run('insert into reports (id, post_id, kind, detail, contact, created_at) values (?, ?, ?, ?, ?, ?)', newId(), postId, 'rights', `${target}\n${detail}`, contact, now());
    return c.html(message('受け付けました', c.get('viewer'), '申し立てを受け付けました。7日以内をめどに確かめます'));
  });

  const version = `第${opts.termsVersion}版`;
  app.get('/terms', (c) => c.html(legalPage(TERMS, c.get('viewer'), version, html`<p><a href="/guidelines">ガイドライン</a>も規約の一部です</p>`)));
  app.get('/guidelines', (c) => c.html(legalPage(GUIDELINES, c.get('viewer'), version, html`<p><a href="/terms">規約</a>に戻る</p>`)));
  app.get('/privacy', (c) => c.html(legalPage(PRIVACY, c.get('viewer'), '', html`<p><a href="/terms">規約</a>も読んでください</p>`)));

  // ---- ログイン ----
  const providers = oauthProviders(opts.oauth);
  if (opts.oauth) mountOAuth({ app, db, origin, termsVersion: opts.termsVersion, oauth: opts.oauth, now, startSession });
  app.get('/login', (c) => {
    const next = safeNext(c.req.query('next'));
    return c.html(
      layout(
        'ログイン',
        c.get('viewer'),
        html`<div style="max-width:440px;margin:24px auto 0" class="stack">
          <div class="card stack" style="text-align:center;padding:24px">
            <h1 style="font-size:20px;font-weight:600">ログイン</h1>
            <p class="faint">パスワードやメールアドレスは預かりません</p>
            ${providers.length
              ? providers.map((p) => html`<a class="btn btn-subtle btn-block" href="/login/${p.name}?next=${encodeURIComponent(next)}">${p.label} でログイン</a>`)
              : html`<p class="faint">ログインの準備中です</p>`}
          </div>
          ${opts.devLogin
            ? html`<form method="post" action="/login/dev" class="card stack">
                <div><h2 style="font-size:15px;font-weight:600">開発用の仮のログイン</h2><p class="faint">試すあいだだけの入口です</p></div>
                <input type="hidden" name="next" value="${next}" />
                <label class="field"><span>名前</span><input name="name" required /></label>
                ${opts.devLoginKey ? html`<label class="field"><span>合言葉</span><input name="key" type="password" required /></label>` : ''}
                <div class="field"><span>18歳以上ですか</span><label class="choice"><input type="radio" name="adult" value="1" /> はい</label><label class="choice"><input type="radio" name="adult" value="0" checked /> いいえ</label></div>
                <label class="choice"><input type="checkbox" name="terms" value="1" /> <span><a href="/terms">規約</a>と<a href="/guidelines">ガイドライン</a>に同意する</span></label>
                ${opts.devAdmin ? html`<label class="choice"><input type="checkbox" name="admin" value="1" /> 運営として入る（手元だけ）</label>` : ''}
                <button class="btn btn-primary btn-block">ログイン</button>
              </form>`
            : ''}
        </div>`,
      ),
    );
  });
  if (opts.devLogin) {
    app.post('/login/dev', async (c) => {
      const body = await c.req.parseBody();
      if (opts.devLoginKey && body.key !== opts.devLoginKey) return c.html(message('ログインできません', null, '合言葉が違います'), 403);
      const name = String(body.name ?? '').trim().slice(0, 40);
      if (!name) return c.html(message('ログインできません', null, '名前を入れてください'), 400);
      let user = await db.get<UserRow>("select * from users where provider = 'dev' and provider_user_id = ?", name);
      if (!user) {
        const id = newId();
        await db.run("insert into users (id, provider, provider_user_id, display_name, created_at) values (?, 'dev', ?, ?, ?)", id, name, name, now());
        user = (await db.get<UserRow>('select * from users where id = ?', id))!;
      }
      await db.run('update users set adult = ?, terms_version = ? where id = ?', body.adult === '1' ? 1 : 0, body.terms === '1' ? opts.termsVersion : user.terms_version, user.id);
      if (opts.devAdmin) await db.run('update users set admin = ? where id = ?', body.admin === '1' ? 1 : 0, user.id);
      await startSession(c, user.id);
      return c.redirect(safeNext(String(body.next ?? '')));
    });
  }
  app.post('/logout', async (c) => {
    const sid = getCookie(c, 'sid');
    if (sid) await db.run('delete from sessions where id = ?', await sha256(sid));
    deleteCookie(c, 'sid', { path: '/' });
    return c.redirect('/');
  });

  // ---- 自分のページ ----
  app.get('/me', async (c) => {
    const viewer = c.get('viewer');
    if (!viewer) return needLogin(c);
    const posts = await db.all<PostRow>("select * from posts where author_id = ? and status != 'withdrawn' order by updated_at desc", viewer.id);
    const tokens = await db.all<{ id: string; label: string; created_at: number; last_used_at: number | null }>('select id, label, created_at, last_used_at from app_tokens where user_id = ? and revoked_at is null', viewer.id);
    const day = (t: number | null) => (t ? new Date(t).toLocaleDateString('ja-JP') : '—');
    return c.html(
      layout(
        '自分のページ',
        viewer,
        html`${pageHead(viewer.display_name, '自分のページ')}
          ${([['plot', 'シナリオ'], ['lorebook', '設定集']] as const).map(([kind, label], i) => {
            const mine = posts.filter((p) => (p.kind ?? 'plot') === kind);
            return html`<section class="section" style="${i === 0 ? 'margin-top:0' : ''}"><h2>自分の${label}</h2>
            <div class="card" style="padding:4px 16px">
              ${mine.length
                ? mine.map(
                    (p) => html`<div class="list-row">
                      <div class="grow">
                        <a href="/s/${p.id}" style="font-weight:600">${p.title}</a> ${ratingBadge(p.rating)}
                        <div class="faint">${p.status === 'hidden' ? html`<span style="color:var(--danger)">運営が非公開にしました（${p.hidden_reason ?? ''}）</span>` : p.visibility === 'public' ? '公開中' : 'URLを知る人だけ'}</div>
                      </div>
                      <form method="post" action="/me/posts/${p.id}/visibility"><input type="hidden" name="visibility" value="${p.visibility === 'public' ? 'unlisted' : 'public'}" /><button class="btn btn-subtle btn-sm">${p.visibility === 'public' ? 'URLを知る人だけにする' : '公開する'}</button></form>
                      <form method="post" action="/me/posts/${p.id}/withdraw"><button class="btn btn-danger btn-sm">取り下げる</button></form>
                    </div>`,
                  )
                : html`<div class="empty" style="padding:24px 0">まだ投稿した${label}はありません。投稿はアプリの${label}の画面から行います</div>`}
            </div>
          </section>`;
          })}
          <section class="section"><h2>年齢とR-18の表示</h2>
            <form method="post" action="/me/settings" class="card stack">
              <div class="field"><span>18歳以上ですか</span><label class="choice"><input type="radio" name="adult" value="1" ${viewer.adult ? 'checked' : ''} /> はい</label><label class="choice"><input type="radio" name="adult" value="0" ${viewer.adult ? '' : 'checked'} /> いいえ</label></div>
              <label class="choice"><input type="checkbox" name="showAdult" value="1" ${viewer.show_adult ? 'checked' : ''} /> R-18とR-18Gを表示する（18歳以上の人だけ）</label>
              <div><button class="btn btn-primary btn-sm">保存</button></div>
            </form>
          </section>
          <section class="section"><h2>連携したアプリ</h2>
            <div class="card" style="padding:4px 16px">
              ${tokens.length
                ? tokens.map(
                    (t) => html`<div class="list-row">
                      <div class="grow"><div style="font-weight:500">${t.label}</div><div class="faint">連携した日 ${day(t.created_at)} ・ 最後に使った日 ${day(t.last_used_at)}</div></div>
                      <form method="post" action="/me/tokens/${t.id}/revoke"><button class="btn btn-danger btn-sm">無効にする</button></form>
                    </div>`,
                  )
                : html`<div class="empty" style="padding:24px 0">連携したアプリはありません</div>`}
            </div>
          </section>`,
      ),
    );
  });
  app.post('/me/settings', async (c) => {
    const viewer = c.get('viewer');
    if (!viewer) return needLogin(c);
    const body = await c.req.parseBody();
    const adult = body.adult === '1' ? 1 : 0;
    await db.run('update users set adult = ?, show_adult = ? where id = ?', adult, adult && body.showAdult === '1' ? 1 : 0, viewer.id);
    return c.redirect('/me');
  });
  const ownPost = async (c: Context<Env>) => {
    const viewer = c.get('viewer');
    const p = await postOf(c.req.param('id') ?? '');
    return viewer && p && p.author_id === viewer.id && p.status !== 'withdrawn' ? p : undefined;
  };
  app.post('/me/posts/:id/visibility', async (c) => {
    const p = await ownPost(c);
    if (!p) return c.notFound();
    const body = await c.req.parseBody();
    await db.run('update posts set visibility = ? where id = ?', body.visibility === 'unlisted' ? 'unlisted' : 'public', p.id);
    return c.redirect('/me');
  });
  app.post('/me/posts/:id/withdraw', async (c) => {
    const p = await ownPost(c);
    if (!p) return c.notFound();
    await withdrawPost(db, blobs, p, now());
    return c.redirect('/me');
  });
  app.post('/me/tokens/:id/revoke', async (c) => {
    const viewer = c.get('viewer');
    if (!viewer) return needLogin(c);
    await db.run('update app_tokens set revoked_at = ? where id = ? and user_id = ?', now(), c.req.param('id'), viewer.id);
    return c.redirect('/me');
  });

  // ---- アプリをつなぐ ----
  app.get('/connect', async (c) => {
    const viewer = c.get('viewer');
    const q = c.req.query();
    if (!REDIRECT_URI.test(q.redirect_uri ?? '') || !q.state || !q.code_challenge || q.code_challenge_method !== 'S256') {
      return c.html(message('連携できません', viewer, 'アプリからの依頼が正しくありません。アプリでもう一度「サイトと連携する」を押してください'), 400);
    }
    if (!viewer) return needLogin(c);
    return c.html(
      layout(
        'アプリとの連携',
        viewer,
        html`<form method="post" class="card center-card">
          <h1>Archsage（このPCのアプリ）と連携しますか</h1>
          <p class="muted">${viewer.display_name} として、シナリオの投稿、更新、取り下げができるようになります。あとで「自分のページ」から無効にできます。</p>
          ${['redirect_uri', 'state', 'code_challenge'].map((k) => html`<input type="hidden" name="${k}" value="${q[k]}" />`)}
          <div class="row" style="justify-content:center;margin-top:18px">
            <button class="btn btn-primary" name="allow" value="1">許可する</button>
            <button class="btn btn-subtle" name="allow" value="0">やめる</button>
          </div>
        </form>`,
      ),
    );
  });
  app.post('/connect', async (c) => {
    const viewer = c.get('viewer');
    if (!viewer) return needLogin(c);
    const body = await c.req.parseBody();
    const redirectUri = String(body.redirect_uri ?? '');
    const state = String(body.state ?? '');
    if (!REDIRECT_URI.test(redirectUri)) return c.html(message('連携できません', viewer, '戻り先が正しくありません'), 400);
    const back = new URL(redirectUri);
    back.searchParams.set('state', state);
    if (body.allow !== '1') {
      back.searchParams.set('error', 'access_denied');
      return c.redirect(back.toString());
    }
    const code = randomToken();
    await db.run('insert into auth_codes (code, user_id, redirect_uri, code_challenge, expires_at) values (?, ?, ?, ?, ?)', await sha256(code), viewer.id, redirectUri, String(body.code_challenge ?? ''), now() + CODE_MINUTES * 6e4);
    back.searchParams.set('code', code);
    return c.redirect(back.toString());
  });

  // ---- アプリが呼ぶ窓口 ----
  const api = new Hono<Env>();
  const fail = (c: Context<Env>, status: 400 | 401 | 403 | 404 | 409, code: string, message: string) => c.json({ error: { code, message } }, status);


  api.get('/meta', (c) =>
    c.json({ apiVersion: 1, bundle: { min: 1, max: BUNDLE_VERSION }, limits: BUNDLE_LIMITS, terms: { version: opts.termsVersion, url: `${opts.baseUrl}/terms` } }),
  );

  api.post('/token', async (c) => {
    const body = await c.req.json<{ code?: string; code_verifier?: string; redirect_uri?: string; label?: string }>().catch(() => ({}) as Record<string, string>);
    const row = body.code ? await db.get<{ code: string; user_id: string; redirect_uri: string; code_challenge: string; expires_at: number }>('select * from auth_codes where code = ?', await sha256(body.code)) : undefined;
    if (row) await db.run('delete from auth_codes where code = ?', row.code);
    if (!row || row.expires_at < now() || row.redirect_uri !== body.redirect_uri || !body.code_verifier || (await sha256(body.code_verifier)) !== row.code_challenge) {
      return fail(c, 400, 'code', '連携のための番号が正しくないか、期限が切れています。もう一度「サイトと連携する」を押してください');
    }
    const token = randomToken();
    const label = String(body.label ?? 'Archsage').slice(0, 40) || 'Archsage';
    await db.run('insert into app_tokens (id, user_id, token_hash, label, created_at) values (?, ?, ?, ?, ?)', newId(), row.user_id, await sha256(token), label, now());
    const user = (await db.get<UserRow>('select * from users where id = ?', row.user_id))!;
    return c.json({ token, user: { id: user.id, displayName: user.display_name } });
  });

  // アプリの鍵が要る窓口に付ける
  const auth: MiddlewareHandler<Env> = async (c, next) => {
    const m = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '');
    const row = m ? await db.get<{ id: string; user_id: string }>('select id, user_id from app_tokens where token_hash = ? and revoked_at is null', await sha256(m[1])) : undefined;
    const user = row ? await db.get<UserRow>('select * from users where id = ?', row.user_id) : undefined;
    if (!row || !user) return fail(c, 401, 'token', 'サイトとの連携が切れています。設定からもう一度連携してください');
    await db.run('update app_tokens set last_used_at = ? where id = ?', now(), row.id);
    c.set('appUser', user);
    c.set('appTokenId', row.id);
    await next();
  };
  api.delete('/token', auth, async (c) => {
    await db.run('update app_tokens set revoked_at = ? where id = ?', now(), c.get('appTokenId'));
    return c.json({ ok: true });
  });
  api.get('/me', auth, (c) => {
    const u = c.get('appUser');
    return c.json({ id: u.id, displayName: u.display_name, adult: !!u.adult, termsVersion: u.terms_version, currentTermsVersion: opts.termsVersion });
  });
  api.post('/me/terms', auth, async (c) => {
    const body = await c.req.json<{ termsVersion?: number }>().catch(() => ({}) as { termsVersion?: number });
    if (body.termsVersion !== opts.termsVersion) return fail(c, 400, 'terms', '規約が新しくなっています。読み直してから同意してください');
    await db.run('update users set terms_version = ? where id = ?', opts.termsVersion, c.get('appUser').id);
    return c.json({ ok: true });
  });
  api.get('/me/posts', auth, async (c) => {
    const rows = await db.all<PostRow>('select * from posts where author_id = ? order by updated_at desc', c.get('appUser').id);
    return c.json({
      posts: rows.map((p) => ({ id: p.id, kind: p.kind, title: p.title, status: p.status, visibility: p.visibility, rating: p.rating, hiddenReason: p.hidden_reason, updatedAt: p.updated_at, url: `${opts.baseUrl}/s/${p.id}` })),
    });
  });

  const readUpload = async (c: Context<Env>): Promise<{ bytes: Uint8Array; meta: PostMeta }> => {
    const user = c.get('appUser');
    if (user.terms_version !== opts.termsVersion) throw new PostError(409, 'terms', '投稿の前に規約への同意が要ります');
    const form = await c.req.parseBody();
    const file = form.bundle;
    if (!(file instanceof File)) throw new PostError(400, 'bundle', 'zip がありません');
    if (file.size > BUNDLE_LIMITS.zipBytes) throw new PostError(400, 'bundle', 'zipが大きすぎます');
    let meta: PostMeta;
    try {
      meta = JSON.parse(String(form.meta ?? '{}'));
    } catch {
      throw new PostError(400, 'meta', '投稿の設定を読めませんでした');
    }
    return { bytes: new Uint8Array(await file.arrayBuffer()), meta };
  };
  const reply = async (c: Context<Env>, p: PostRow) => c.json({ post: postRef(opts.baseUrl, p, c.get('appUser').display_name), url: `${opts.baseUrl}/s/${p.id}`, status: p.status, visibility: p.visibility });

  api.post('/posts', auth, async (c) => {
    const { bytes, meta } = await readUpload(c);
    return reply(c, await savePost(db, blobs, images, c.get('appUser'), bytes, meta, now()));
  });
  const mine = async (c: Context<Env>) => {
    const p = await postOf(c.req.param('id') ?? '');
    if (!p || p.status === 'withdrawn') throw new PostError(404, 'not_found', 'この投稿は見つからないか、取り下げられています');
    if (p.author_id !== c.get('appUser').id) throw new PostError(403, 'not_owner', '自分の投稿ではありません');
    return p;
  };
  api.put('/posts/:id', auth, async (c) => {
    const p = await mine(c);
    const { bytes, meta } = await readUpload(c);
    return reply(c, await savePost(db, blobs, images, c.get('appUser'), bytes, meta, now(), p));
  });
  api.delete('/posts/:id', auth, async (c) => {
    const p = await mine(c);
    await withdrawPost(db, blobs, p, now());
    return c.json({ ok: true });
  });

  // 「アプリで開く」の受け取り。鍵は要らない。R-18は引換券を1回だけ使う
  api.post('/bundles', async (c) => {
    const body = await c.req.json<{ postId?: string; ticket?: string }>().catch(() => ({}) as { postId?: string; ticket?: string });
    const p = body.postId ? await postOf(body.postId) : undefined;
    if (!p || p.status !== 'live') return fail(c, 404, 'not_found', 'このシナリオは公開されていません');
    if (p.rating !== 'all') {
      const t = body.ticket ? await db.get<{ id: string; post_id: string; expires_at: number; used_at: number | null }>('select * from tickets where id = ?', await sha256(body.ticket)) : undefined;
      if (!t || t.post_id !== p.id || t.used_at || t.expires_at < now()) return fail(c, 403, 'ticket', '受け取りの期限が切れています。サイトでもう一度「アプリで開く」を押してください');
      await db.run('update tickets set used_at = ? where id = ?', now(), t.id);
    }
    const zip = await buildBundle(blobs, p, postRef(opts.baseUrl, p, await authorName(p.author_id)));
    if (!zip) return fail(c, 404, 'not_found', 'このシナリオの中身を読めませんでした');
    await db.run('update posts set opens = opens + 1 where id = ?', p.id);
    return c.body(zip as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'application/zip' });
  });

  mountAdmin(app, db, now);
  app.route('/api/v1', api);
  app.onError((e, c) => {
    if (e instanceof PostError) return fail(c, e.status, e.code, e.message);
    console.error(e);
    return c.json({ error: { code: 'server', message: 'サイトで問題が起きました' } }, 500);
  });
  return app;
}

