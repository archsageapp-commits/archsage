import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Plot } from '@archsage/shared';
import { imageUrl } from '../api.ts';
import { RATING_LABELS } from '../terms.ts';
import { cx, Icon } from '../ui.tsx';

// サムネイルの縦横比。カードと枠はすべてここに合わせる（1024×1536 の 2:3）
export const COVER_ASPECT = 'aspect-[2/3]';

// シナリオのカード。絵を大きく見せ、題名と一言紹介とハッシュタグは絵の下のほうに重ねる
export function PlotCard({ p, to, corner, badges, footer }: { p: Plot; to: string; corner?: ReactNode; badges?: ReactNode; footer?: ReactNode }) {
  const tagline = p.listing.tagline || p.story.slice(0, 60);
  return (
    <div className="group relative">
      <Link to={to} className={cx('relative block overflow-hidden rounded-xl border border-line bg-panel2 transition-[border-color,box-shadow] hover:border-gold/50 hover:shadow-md', COVER_ASPECT)}>
        {p.listing.cover ? (
          <img src={imageUrl(p.listing.cover)} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full items-start justify-center pt-[30%] text-faint">
            <Icon name="image" size={28} />
          </div>
        )}
        {/* 絵の色にかかわらず文字が読めるよう、下に向かって暗くする */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2.5 pb-2.5 pt-12 text-white">
          <div className="line-clamp-1 text-[13px] font-semibold leading-snug [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">{p.title || '（無題）'}</div>
          {tagline && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/85">{tagline}</div>}
          {p.listing.hashtags.length > 0 && <div className="mt-1 truncate text-[10.5px] text-white/60">{p.listing.hashtags.map((t) => `#${t}`).join(' ')}</div>}
        </div>
        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
          {p.listing.rating !== 'all' && <Pill tone="danger">{RATING_LABELS[p.listing.rating]}</Pill>}
          {badges}
        </div>
      </Link>
      {corner && <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">{corner}</div>}
      {footer}
    </div>
  );
}

// 絵の上に重ねる小さな札
export function Pill({ children, tone = 'dark' }: { children: ReactNode; tone?: 'dark' | 'danger' | 'gold' }) {
  const t = { dark: 'bg-black/55 text-white', danger: 'bg-danger/90 text-white', gold: 'bg-gold/90 text-on-gold' }[tone];
  return <span className={cx('rounded px-1.5 py-px text-[10.5px] font-medium leading-4 backdrop-blur-sm', t)}>{children}</span>;
}

// カードを並べる。広い画面では1行に5枚にし、狭くなるほど減らす。投稿サイト（site/src/pages.ts の .grid）も同じ
export function PlotGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">{children}</div>;
}

// 新しく作るカード。ほかのカードと同じ大きさにする
export function NewPlotTile({ onClick, label, sub }: { onClick: () => void; label: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-dim transition-colors hover:border-gold/60 hover:text-gold-soft', COVER_ASPECT)}
    >
      <Icon name="plus" size={26} />
      <span className="text-[13px] font-medium">{label}</span>
      <span className="text-[11px] text-faint">{sub}</span>
    </button>
  );
}
