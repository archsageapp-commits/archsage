import type { Context, Hono } from 'hono';
import { html } from 'hono/html';
import { newId } from '@archsage/shared';
import type { Env } from './app.ts';
import type { Db } from './db.ts';
import { REPORT_KINDS } from './labels.ts';
import { layout, pageHead, ratingBadge } from './pages.ts';
import type { PostRow, UserRow } from './posts.ts';

// 運営の画面。users.admin が 1 の人だけが使え、ほかの人には無いものとして 404 を返す。
// 通報の対応も、運営が自分で見つけて非公開にしたものも、reports に記録する

interface ReportRow {
  id: string;
  post_id: string | null;
  kind: string;
  detail: string;
  contact: string | null;
  created_at: number;
  resolved_at: number | null;
  action: string | null;
}

// 対応の目安（要求仕様の「通報と削除の窓口」）
const DUE_DAYS = 7;

const KIND_LABELS: Record<string, string> = { ...REPORT_KINDS, staff: '運営が見つけた' };

export async function hidePost(db: Db, postId: string, reason: string): Promise<void> {
  await db.run("update posts set status = 'hidden', hidden_reason = ? where id = ? and status = 'live'", reason, postId);
}

export function mountAdmin(app: Hono<Env>, db: Db, now: () => number): void {
  const isAdmin = (u: UserRow | null) => !!u?.admin;
  const day = (t: number) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const field = (body: Record<string, unknown>, k: string, n: number) => String(body[k] ?? '').trim().slice(0, n);
  // その投稿への、まだ対応していない通報をまとめて閉じる
  const resolve = (postId: string, action: string) => db.run('update reports set resolved_at = ?, action = ? where post_id = ? and resolved_at is null', now(), action, postId);
  const back = (c: Context<Env>) => c.redirect('/admin');

  app.use('/admin/*', async (c, next) => (isAdmin(c.get('viewer')) ? next() : c.notFound()));
  app.use('/admin', async (c, next) => (isAdmin(c.get('viewer')) ? next() : c.notFound()));

  app.get('/admin', async (c) => {
    const open = await db.all<ReportRow>('select * from reports where resolved_at is null order by created_at');
    const done = await db.all<ReportRow>('select * from reports where resolved_at is not null order by resolved_at desc limit 30');
    const hidden = await db.all<PostRow & { author_name: string; author_suspended: number | null }>("select p.*, u.display_name as author_name, u.suspended_at as author_suspended from posts p join users u on u.id = p.author_id where p.status = 'hidden' order by p.updated_at desc");
    const suspended = await db.all<UserRow>('select * from users where suspended_at is not null order by suspended_at desc');
    const ids = [...new Set([...open, ...done].map((r) => r.post_id).filter((x): x is string => !!x))];
    const posts = new Map<string, PostRow & { author_name: string; author_suspended: number | null }>();
    for (const id of ids) {
      const p = await db.get<PostRow & { author_name: string; author_suspended: number | null }>(
        'select p.*, u.display_name as author_name, u.suspended_at as author_suspended from posts p join users u on u.id = p.author_id where p.id = ?',
        id,
      );
      if (p) posts.set(id, p);
    }
    const target = (r: ReportRow) => {
      const p = r.post_id ? posts.get(r.post_id) : undefined;
      if (!p) return html`<span class="faint">対象のシナリオが見つかりません（URLが違うか、サイトの外のもの）</span>`;
      const state = p.status === 'live' ? '公開中' : p.status === 'hidden' ? `非公開（${p.hidden_reason ?? ''}）` : '取り下げ済み';
      return html`<a href="/s/${p.id}" style="font-weight:600">${p.title}</a> ${ratingBadge(p.rating)} <span class="faint">作者: ${p.author_name}${p.author_suspended ? '（利用停止中）' : ''} ・ ${state}</span>`;
    };
    const openCard = (r: ReportRow) => {
      const p = r.post_id ? posts.get(r.post_id) : undefined;
      const late = now() - r.created_at > DUE_DAYS * 864e5;
      return html`<div class="card stack">
        <div class="row"><span class="badge badge-gold">${KIND_LABELS[r.kind] ?? r.kind}</span><span class="faint">${day(r.created_at)}</span>${late ? html`<span class="badge badge-adult">${DUE_DAYS}日を過ぎています</span>` : ''}</div>
        <div>${target(r)}</div>
        <p class="prose" style="font-size:13.5px">${r.detail}</p>
        ${r.contact ? html`<p class="faint">連絡先: ${r.contact}</p>` : ''}
        ${p?.status === 'live'
          ? html`<form method="post" action="/admin/reports/${r.id}/hide" class="row">
              <input name="reason" value="${KIND_LABELS[r.kind] ?? ''}" required style="flex:1;min-width:220px" /> <button class="btn btn-danger btn-sm">非公開にする</button>
            </form>`
          : ''}
        <form method="post" action="/admin/reports/${r.id}/dismiss" class="row">
          <input name="note" placeholder="対応しない理由（自分用のメモ）" style="flex:1;min-width:220px" /> <button class="btn btn-subtle btn-sm">${p?.status === 'live' ? '対応しない' : '閉じる'}</button>
        </form>
        ${p && !p.author_suspended
          ? html`<form method="post" action="/admin/users/${p.author_id}/suspend" class="row"><button class="btn btn-ghost btn-sm">作者の利用を止める</button><span class="faint">投稿と更新ができなくなります。投稿はそのまま残ります</span></form>`
          : ''}
      </div>`;
    };
    return c.html(
      layout(
        '運営',
        c.get('viewer'),
        html`${pageHead('運営', `対応の目安は${DUE_DAYS}日以内。迷うものは先に非公開にする。非公開の理由は作者に見えます`)}
          <section class="section" style="margin-top:0"><h2>まだ対応していない通報（${open.length}件）</h2>
            ${open.length ? open.map(openCard) : html`<div class="card empty" style="padding:24px 0">ありません</div>`}
          </section>
          <section class="section"><h2>非公開の投稿（${hidden.length}件）</h2>
            <div class="card" style="padding:4px 16px">
              ${hidden.length
                ? hidden.map(
                    (p) => html`<div class="list-row">
                      <div class="grow"><a href="/s/${p.id}" style="font-weight:600">${p.title}</a> ${ratingBadge(p.rating)}<div class="faint">作者: ${p.author_name} ・ 理由: ${p.hidden_reason ?? ''}</div></div>
                      <form method="post" action="/admin/posts/${p.id}/restore"><button class="btn btn-subtle btn-sm">公開に戻す</button></form>
                      ${p.author_suspended ? '' : html`<form method="post" action="/admin/users/${p.author_id}/suspend"><button class="btn btn-ghost btn-sm">作者の利用を止める</button></form>`}
                    </div>`,
                  )
                : html`<div class="empty" style="padding:24px 0">ありません</div>`}
            </div>
          </section>
          <section class="section"><h2>利用を止めている人（${suspended.length}件）</h2>
            <div class="card" style="padding:4px 16px">
              ${suspended.length
                ? suspended.map(
                    (u) => html`<div class="list-row">
                      <div class="grow">${u.display_name}<div class="faint">${u.provider} ・ 止めた日 ${day(u.suspended_at!)}</div></div>
                      <form method="post" action="/admin/users/${u.id}/unsuspend"><button class="btn btn-subtle btn-sm">戻す</button></form>
                    </div>`,
                  )
                : html`<div class="empty" style="padding:24px 0">いません</div>`}
            </div>
          </section>
          <section class="section"><h2>最近の対応</h2>
            <div class="card" style="padding:4px 16px">
              ${done.length
                ? done.map((r) => html`<div class="list-row"><div class="grow"><div class="faint">${day(r.resolved_at!)} ・ ${KIND_LABELS[r.kind] ?? r.kind}</div><div>${target(r)}</div><div class="faint">${r.action ?? ''}</div></div></div>`)
                : html`<div class="empty" style="padding:24px 0">まだありません</div>`}
            </div>
          </section>`,
      ),
    );
  });

  const reportOf = (c: Context<Env>) => db.get<ReportRow>('select * from reports where id = ? and resolved_at is null', c.req.param('id') ?? '');

  app.post('/admin/reports/:id/hide', async (c) => {
    const r = await reportOf(c);
    if (!r?.post_id) return back(c);
    const reason = field(await c.req.parseBody(), 'reason', 200) || KIND_LABELS[r.kind] || '運営の判断';
    await hidePost(db, r.post_id, reason);
    await resolve(r.post_id, `非公開にした: ${reason}`);
    return back(c);
  });
  app.post('/admin/reports/:id/dismiss', async (c) => {
    const r = await reportOf(c);
    if (!r) return back(c);
    const note = field(await c.req.parseBody(), 'note', 500);
    await db.run('update reports set resolved_at = ?, action = ? where id = ?', now(), `対応しない${note ? `: ${note}` : ''}`, r.id);
    return back(c);
  });

  // 通報がなくても、シナリオのページから非公開にできる
  app.post('/admin/posts/:id/hide', async (c) => {
    const id = c.req.param('id');
    const reason = field(await c.req.parseBody(), 'reason', 200) || '運営の判断';
    const p = await db.get<PostRow>("select * from posts where id = ? and status = 'live'", id);
    if (p) {
      await hidePost(db, id, reason);
      await db.run('insert into reports (id, post_id, kind, detail, contact, created_at, resolved_at, action) values (?, ?, ?, ?, null, ?, ?, ?)', newId(), id, 'staff', reason, now(), now(), `非公開にした: ${reason}`);
      await resolve(id, `非公開にした: ${reason}`);
    }
    return c.redirect(`/s/${id}`);
  });
  app.post('/admin/posts/:id/restore', async (c) => {
    const id = c.req.param('id');
    await db.run("update posts set status = 'live', hidden_reason = null where id = ? and status = 'hidden'", id);
    await db.run('insert into reports (id, post_id, kind, detail, contact, created_at, resolved_at, action) values (?, ?, ?, ?, null, ?, ?, ?)', newId(), id, 'staff', '公開に戻す', now(), now(), '公開に戻した');
    return back(c);
  });

  app.post('/admin/users/:id/suspend', async (c) => {
    // 押し間違いで自分を止めないようにする
    if (c.req.param('id') !== c.get('viewer')!.id) await db.run('update users set suspended_at = ? where id = ? and suspended_at is null', now(), c.req.param('id'));
    return back(c);
  });
  app.post('/admin/users/:id/unsuspend', async (c) => {
    await db.run('update users set suspended_at = null where id = ?', c.req.param('id'));
    return back(c);
  });
}
