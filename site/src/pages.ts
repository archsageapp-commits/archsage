import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { RATING_LABELS_JA } from './labels.ts';
import type { LegalDoc } from './legal.ts';
import type { PostRow, UserRow } from './posts.ts';

// サイトの画面の部品。色と部品の形はアプリ（web/src/index.css、web/src/ui.tsx）にそろえる

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const STYLE = `
:root{color-scheme:light;accent-color:#94650f;--bg:#f5f1e8;--panel:#fffcf6;--panel2:#eee7da;--line:#e0d5c2;--line-strong:#c9bba3;--hover:#e7dfd0;--ink:#2a241c;--dim:#5f5648;--faint:#807563;--gold:#94650f;--gold-soft:#7a520a;--danger:#b53f39;--danger-bg:#fbeae7;--danger-line:#e9bfba;--ok:#2f7f4c}
*{box-sizing:border-box}
html{scrollbar-width:thin;scrollbar-color:#cbbfa9 transparent}
body{margin:0;font-family:'Noto Sans JP','Hiragino Sans','Yu Gothic UI','Meiryo',system-ui,sans-serif;font-size:14px;line-height:1.6;background:var(--bg);color:var(--ink)}
a{color:var(--gold);text-decoration:none}a:hover{color:var(--gold-soft);text-decoration:underline}
h1,h2,h3{margin:0;line-height:1.35}
p{margin:0}
::selection{background:color-mix(in oklab,var(--gold) 30%,transparent)}
.container{max-width:1080px;margin:0 auto;padding:0 20px}
.site-header{position:sticky;top:0;z-index:10;background:color-mix(in oklab,var(--panel) 88%,transparent);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.site-header .container{display:flex;align-items:center;gap:6px;height:56px}
.brand{display:flex;align-items:center;gap:9px;margin-right:auto;font-weight:600;font-size:15px;letter-spacing:.02em;color:var(--gold-soft)}
.brand:hover{color:var(--gold-soft);text-decoration:none}
.brand svg{width:30px;height:30px}
.brand small{font-weight:400;font-size:11px;color:var(--faint)}
.nav a{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border-radius:6px;color:var(--dim);font-size:13.5px}
.nav a:hover{background:var(--panel2);color:var(--ink);text-decoration:none}
.nav a svg{width:15px;height:15px}
.nav form{display:inline}
main{padding:28px 0 40px}
.site-footer{border-top:1px solid var(--line);padding:18px 0 28px;font-size:12px;color:var(--faint)}
.site-footer .container{display:flex;flex-wrap:wrap;gap:14px;align-items:center}
.site-footer a{color:var(--dim)}
.page-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:20px}
.page-head h1{font-size:22px;font-weight:600}
.page-head p{margin-top:4px;font-size:12.5px;color:var(--faint)}
.section{margin-top:28px}
.section>h2{font-size:15px;font-weight:600;margin-bottom:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.card+.card{margin-top:12px}
.stack>*+*{margin-top:14px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.muted{color:var(--dim)}
.faint{color:var(--faint);font-size:12px}
.prose{white-space:pre-wrap;line-height:1.85;font-size:14.5px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border-radius:6px;border:1px solid transparent;font:inherit;font-size:14px;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s,color .15s;text-decoration:none}
.btn:hover{text-decoration:none}
.btn svg{width:15px;height:15px}
.btn-primary{background:var(--gold);color:#fff;font-weight:500}
.btn-primary:hover{background:var(--gold-soft);color:#fff}
.btn-subtle{background:var(--panel2);color:var(--ink);border-color:var(--line)}
.btn-subtle:hover{background:var(--hover);border-color:var(--line-strong);color:var(--ink)}
.btn-ghost{background:transparent;color:var(--dim)}
.btn-ghost:hover{background:var(--panel2);color:var(--ink)}
.btn-danger{background:transparent;color:var(--danger);border-color:var(--danger-line)}
.btn-danger:hover{background:var(--danger-bg);color:var(--danger)}
.btn-sm{height:28px;padding:0 10px;font-size:12px;gap:4px}
.btn-block{width:100%}
.btn[disabled]{opacity:.45;cursor:default;pointer-events:none}
.field{display:block}
.field>span{display:block;margin-bottom:6px;font-size:13px;font-weight:500}
.field>small{display:block;margin-top:5px;font-size:12px;color:var(--faint)}
input[type=text],input[type=password],input[type=url],input:not([type]),textarea,select{width:100%;background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:0 12px;height:36px;font:inherit;transition:border-color .15s,box-shadow .15s}
textarea{height:auto;padding:8px 12px;line-height:1.6;resize:vertical}
input::placeholder,textarea::placeholder{color:var(--faint)}
input:focus,textarea:focus,select:focus{outline:none;border-color:color-mix(in oklab,var(--gold) 60%,transparent);box-shadow:0 0 0 3px color-mix(in oklab,var(--gold) 15%,transparent)}
.choice{display:inline-flex;align-items:center;gap:6px;margin-right:14px;cursor:pointer}
.choice-list{display:grid;gap:8px}
.choice-list label{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer}
.choice-list label:hover{border-color:var(--line-strong)}
.choice-list input{margin-top:4px}
.badge{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:4px;padding:0 6px;font-size:11px;line-height:18px;color:var(--dim);background:var(--panel2);vertical-align:middle}
.badge-adult{border-color:var(--danger-line);background:var(--danger-bg);color:var(--danger)}
.badge-gold{border-color:color-mix(in oklab,var(--gold) 30%,transparent);background:color-mix(in oklab,var(--gold) 10%,transparent);color:var(--gold)}
.badge-ok{border-color:color-mix(in oklab,var(--ok) 30%,transparent);background:color-mix(in oklab,var(--ok) 10%,transparent);color:var(--ok)}
.chip{display:inline-flex;align-items:center;border-radius:999px;background:var(--panel2);border:1px solid var(--line);padding:0 9px;font-size:11.5px;line-height:20px;color:var(--dim)}
.notice{border:1px solid color-mix(in oklab,var(--gold) 30%,transparent);background:color-mix(in oklab,var(--gold) 8%,transparent);color:var(--gold-soft);border-radius:8px;padding:10px 14px;font-size:13px}
.notice-danger{border-color:var(--danger-line);background:var(--danger-bg);color:var(--danger)}
.search{display:flex;gap:8px;max-width:520px}
.search input{flex:1}
.ad{border:1px dashed var(--line-strong);border-radius:8px;color:var(--faint);text-align:center;padding:14px;margin:20px 0;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
@media(max-width:1000px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:780px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:560px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.post-card{position:relative;display:block;background:var(--panel2);border:1px solid var(--line);border-radius:12px;overflow:hidden;color:#fff;transition:border-color .15s,box-shadow .15s}
.post-card:hover{border-color:color-mix(in oklab,var(--gold) 50%,transparent);box-shadow:0 4px 12px rgb(0 0 0/.12);text-decoration:none;color:#fff}
.post-card .cover img{transition:transform .3s}
.post-card:hover .cover img{transform:scale(1.03)}
.post-card .cover svg{margin-bottom:30%}
.post-card .overlay{position:absolute;left:0;right:0;bottom:0;padding:48px 10px 10px;background:linear-gradient(to top,rgb(0 0 0/.85),rgb(0 0 0/.55) 50%,transparent);pointer-events:none}
.post-card .title{font-weight:600;font-size:13px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgb(0 0 0/.5)}
.post-card .tagline{margin-top:2px;font-size:11px;line-height:1.35;color:rgb(255 255 255/.85);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.post-card .tags,.post-card .author{margin-top:4px;font-size:10.5px;color:rgb(255 255 255/.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.post-card .author{margin-top:2px}
.post-card .pill{position:absolute;left:8px;top:8px;border-radius:4px;padding:0 6px;font-size:10.5px;font-weight:500;line-height:16px;background:color-mix(in oklab,var(--danger) 90%,transparent);color:#fff}
.cover{aspect-ratio:2/3;width:100%;background:var(--panel2);display:flex;align-items:center;justify-content:center;color:var(--faint);overflow:hidden}
.cover img{width:100%;height:100%;object-fit:cover;display:block}
.cover svg{width:28px;height:28px;opacity:.6}
.empty{padding:48px 0;text-align:center;color:var(--faint)}
.layout-2{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;align-items:start}
.layout-2 aside{position:sticky;top:76px}
@media(max-width:820px){.layout-2{grid-template-columns:1fr}.layout-2 aside{position:static}}
.post-title{font-size:24px;font-weight:600}
.char{display:flex;gap:12px;align-items:flex-start}
.char+.char{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.avatar{width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid var(--line);background:var(--panel2);display:flex;align-items:center;justify-content:center;color:var(--dim)}
.list-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 0}
.list-row+.list-row{border-top:1px solid var(--line)}
.list-row .grow{flex:1;min-width:200px}
.center-card{max-width:520px;margin:40px auto 0;text-align:center}
.center-card h1{font-size:20px;font-weight:600;margin-bottom:8px}
.legal h2{font-size:16px;font-weight:600;margin:28px 0 8px}
.legal ul{margin:0;padding-left:20px}
.legal li{margin:6px 0}
.legal p+p{margin-top:10px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:16px}
.tabs a{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;margin-bottom:-1px;border-bottom:2px solid transparent;color:var(--dim)}
.tabs a:hover{color:var(--ink);text-decoration:none}
.tabs a.on{color:var(--ink);font-weight:600;border-color:var(--gold)}
.tabs svg{width:16px;height:16px}
.lore-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media(max-width:780px){.lore-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.lore-grid{grid-template-columns:1fr}}
.lore-card{display:block;padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-radius:12px;color:var(--ink);transition:border-color .15s,box-shadow .15s}
.lore-card:hover{border-color:color-mix(in oklab,var(--gold) 50%,transparent);box-shadow:0 4px 12px rgb(0 0 0/.08);text-decoration:none;color:var(--ink)}
.lore-card .title{display:flex;align-items:center;gap:6px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lore-card .title svg{width:16px;height:16px;flex-shrink:0;color:var(--gold)}
.lore-card .tagline{margin-top:4px;font-size:13px;color:var(--dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lore-card .meta{margin-top:8px;font-size:11.5px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.entry+.entry{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.entry-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px}
`;

// アプリと同じ、金茶の地に白い A
// アイコンは web/public/favicon.svg と同じ（ゆるいフクロウの正面の顔）
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#94650f"/><path d="M13 13 Q19 15 23 20 Q32 17 41 20 Q45 15 51 13 Q50 22 48 27 Q51 33 50 39 Q48 55 32 55 Q16 55 14 39 Q13 33 16 27 Q14 22 13 13 Z" fill="#fffaf0"/><path d="M32 23 Q20 20 16 30 Q15 42 25 44 Q30 43 32 38 Q34 43 39 44 Q49 42 48 30 Q44 20 32 23 Z" fill="#f6dfa8"/><circle cx="25" cy="32" r="6" fill="#fffaf0"/><circle cx="39" cy="32" r="6" fill="#fffaf0"/><circle cx="25" cy="32" r="3.6" fill="#94650f"/><circle cx="39" cy="32" r="3.6" fill="#94650f"/><path d="M30 38 H34 L32 43 Z" fill="#94650f"/></svg>';
const FAVICON = `data:image/svg+xml,${encodeURIComponent(LOGO)}`;

// 線画のアイコン。形はアプリ（web/src/ui.tsx）と同じ
const ICONS: Record<string, string> = {
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14',
  play: 'M7 5l12 7-12 7z',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  shield: 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z',
  check: 'M5 12l5 5 9-10',
  left: 'M15 6l-6 6 6 6',
  book: 'M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h10',
};

export function icon(name: string): Html {
  return html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] ?? ''}" /></svg>`;
}

export function layout(title: string, viewer: UserRow | null, body: Html): Html {
  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} | Archsage シナリオ置き場</title>
        <link rel="icon" href="${FAVICON}" />
        <style>
          ${raw(STYLE)}
        </style>
      </head>
      <body>
        <header class="site-header">
          <div class="container">
            <a class="brand" href="/">${raw(LOGO)}<span>Archsage シナリオ置き場</span></a>
            <nav class="nav">
              ${viewer?.admin ? html`<a href="/admin">${icon('shield')}運営</a>` : ''}
              ${viewer
                ? html`<a href="/me">${icon('user')}${viewer.display_name}</a>
                    <form method="post" action="/logout"><button class="btn btn-ghost btn-sm">ログアウト</button></form>`
                : html`<a href="/login" class="btn btn-subtle btn-sm">ログイン</a>`}
            </nav>
          </div>
        </header>
        <main><div class="container">${body}</div></main>
        <footer class="site-footer">
          <div class="container">
            <a href="/terms">規約</a><a href="/guidelines">ガイドライン</a><a href="/privacy">プライバシーポリシー</a><a href="/takedown">権利者の方へ（削除の申し立て）</a>
            <span style="margin-left:auto">遊ぶには Archsage のアプリが要ります</span>
          </div>
        </footer>
      </body>
    </html>`;
}

export function pageHead(title: Html | string, sub?: Html | string, right?: Html): Html {
  return html`<div class="page-head">
    <div>
      <h1>${title}</h1>
      ${sub ? html`<p>${sub}</p>` : ''}
    </div>
    ${right ?? ''}
  </div>`;
}

export function ratingBadge(rating: PostRow['rating']): Html | '' {
  return rating === 'all' ? '' : html`<span class="badge badge-adult">${RATING_LABELS_JA[rating]}</span>`;
}

export function hashtags(json: string | string[]): Html | '' {
  const list = Array.isArray(json) ? json : (JSON.parse(json || '[]') as string[]);
  return list.length ? html`<div class="row">${list.map((t) => html`<span class="chip">#${t}</span>`)}</div>` : '';
}

// アプリのカード（web/src/components/PlotCard.tsx）と同じく、題名などを絵の下のほうに重ねる
export function postCard(p: PostRow & { author_name: string }): Html {
  const tags = (JSON.parse(p.hashtags || '[]') as string[]).map((t) => `#${t}`).join(' ');
  return html`<a class="post-card" href="/s/${p.id}">
    <div class="cover">${p.has_cover ? html`<img src="/s/${p.id}/cover" alt="" loading="lazy" />` : icon('image')}</div>
    <div class="overlay">
      <div class="title">${p.title}</div>
      ${p.tagline ? html`<div class="tagline">${p.tagline}</div>` : ''}
      ${tags ? html`<div class="tags">${tags}</div>` : ''}
      <div class="author">${p.author_name}</div>
    </div>
    ${p.rating !== 'all' ? html`<span class="pill">${RATING_LABELS_JA[p.rating]}</span>` : ''}
  </a>`;
}

// 設定集のカード。画像はないので、文字だけで見せる
export function loreCard(p: PostRow & { author_name: string }): Html {
  const tags = (JSON.parse(p.hashtags || '[]') as string[]).map((t) => `#${t}`).join(' ');
  return html`<a class="lore-card" href="/s/${p.id}">
    <div class="title">${icon('book')}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis">${p.title}</span>${p.rating !== 'all' ? html`<span class="badge badge-adult">${RATING_LABELS_JA[p.rating]}</span>` : ''}</div>
    ${p.tagline ? html`<div class="tagline">${p.tagline}</div>` : ''}
    <div class="meta">${p.author_name}${tags ? html` ・ ${tags}` : ''}</div>
  </a>`;
}

// 一覧の上のタブ。シナリオと設定集を分けて並べる
export function listTabs(kind: 'plot' | 'lorebook', q: string): Html {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return html`<nav class="tabs">
    <a href="/${qs}" class="${kind === 'plot' ? 'on' : ''}">${icon('play')}シナリオ</a>
    <a href="/lorebooks${qs}" class="${kind === 'lorebook' ? 'on' : ''}">${icon('book')}設定集</a>
  </nav>`;
}

export function legalPage(doc: LegalDoc, viewer: UserRow | null, note: string, links: Html | ''): Html {
  return layout(
    doc.title,
    viewer,
    html`<div class="card legal" style="max-width:780px;margin:0 auto;padding:24px 28px">
      ${pageHead(doc.title, note)}
      ${doc.intro.map((p) => html`<p>${p}</p>`)}
      ${doc.sections.map((s, i) => html`<h2>${i + 1}. ${s.title}</h2>${s.lead ? html`<p>${s.lead}</p>` : ''}<ul>${s.items.map((t) => html`<li>${t}</li>`)}</ul>`)}
      ${(doc.closing ?? []).map((p) => html`<p class="faint" style="margin-top:24px">${p}</p>`)}
      <div style="margin-top:20px">${links}</div>
    </div>`,
  );
}

export function message(title: string, viewer: UserRow | null, text: string, link?: { href: string; label: string }): Html {
  return layout(
    title,
    viewer,
    html`<div class="card center-card">
      <h1>${title}</h1>
      <p class="muted">${text}</p>
      <div class="row" style="justify-content:center;margin-top:18px">
        ${link ? html`<a class="btn btn-primary" href="${link.href}">${link.label}</a>` : ''}
        <a class="btn btn-subtle" href="/">一覧に戻る</a>
      </div>
    </div>`,
  );
}
