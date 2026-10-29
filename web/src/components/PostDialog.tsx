import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Lorebook, Plot, PostRef, Rating } from '@archsage/shared';
import { api, imageUrl, type PostOptions, type SitePost } from '../api.ts';
import { RATING_LABELS, T } from '../terms.ts';
import { Badge, Button, ConfirmButton, ErrorText, Field, Input, Modal, Segmented, Spinner } from '../ui.tsx';

// 投稿するもの。シナリオと設定集で、確かめることと送り先だけが違う
export interface PostItem {
  kind: 'plot' | 'lorebook';
  title: string;
  listing: { tagline: string; hashtags: string[]; rating: Rating; sourceTitle: string; cover?: string };
  posted?: PostRef;
  origin?: PostRef;
  images: string[]; // サイトに出る画像
  problems: string[];
  listingWhere: string; // 紹介文やタグを直す場所
  post: (o: PostOptions) => Promise<{ url: string }>;
  withdraw: () => Promise<unknown>;
}

export function plotPostItem(plot: Plot): PostItem {
  return {
    kind: 'plot',
    title: plot.title,
    listing: plot.listing,
    posted: plot.posted,
    origin: plot.origin,
    images: [plot.listing.cover, ...plot.characters.map((c) => c.avatar)].filter((x): x is string => !!x),
    problems: [
      plot.title.trim() ? '' : '題名がありません',
      plot.characters.length ? '' : `${T.character}がいません`,
      plot.intros.some((i) => i.text.trim()) ? '' : `${T.intro}がありません`,
    ].filter(Boolean),
    listingWhere: `編集画面の「${T.listing}」`,
    post: (o) => api.postPlot(plot.id, o),
    withdraw: () => api.withdrawPlot(plot.id),
  };
}

// 設定集は画像がなく、紹介は設定集の画面で直す。保存していない変更は送らないので、保存してから開く
export function lorebookPostItem(book: Lorebook): PostItem {
  const listing = book.listing ?? { tagline: '', hashtags: [], intro: '', creatorComment: '', rating: 'all' as const, sourceTitle: '' };
  return {
    kind: 'lorebook',
    title: book.name,
    listing,
    posted: book.posted,
    origin: book.origin,
    images: [],
    problems: [book.name.trim() ? '' : '名前がありません', book.entries.some((e) => e.content.trim()) ? '' : '中身のある項目がありません'].filter(Boolean),
    listingWhere: `${T.lorebook}の画面の「投稿の紹介」`,
    post: (o) => api.postLorebook(book.id, o),
    withdraw: () => api.withdrawLorebook(book.id),
  };
}

// 投稿サイトへの投稿と更新、取り下げ。中身（紹介文やタグ）は編集画面で直し、ここでは投稿ごとに決めることだけ選ぶ
export function PostDialog({ item, sitePost, onClose }: { item: PostItem; sitePost?: SitePost; onClose: () => void }) {
  const what = item.kind === 'lorebook' ? T.lorebook : T.plot;
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const site = settings.data?.site;
  const account = useQuery({ queryKey: ['siteAccount'], queryFn: api.siteAccount, enabled: !!site?.connected, retry: false });
  const me = site?.user;
  const mine = (ref?: PostRef) => !!ref && !!me && ref.site === site?.url && ref.authorId === me.id;
  const updating = mine(item.posted);
  const ownOrigin = !updating && mine(item.origin);
  const remixOf = item.origin && !mine(item.origin) ? item.origin : undefined;

  const [rating, setRating] = useState<Rating>(item.listing.rating);
  const [ratingOk, setRatingOk] = useState(false);
  const [sourceTitle, setSourceTitle] = useState(item.listing.sourceTitle ?? '');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>(sitePost?.visibility ?? 'public');
  const [target, setTarget] = useState<'new' | 'update'>('update');
  const [imagesChecked, setImagesChecked] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string>();

  const needsTerms = !!account.data && account.data.termsVersion < account.data.currentTermsVersion;
  const adultRating = rating !== 'all';
  // 画像の修正を確かめるのは、画像を出すシナリオだけ
  const checkImages = adultRating && item.kind === 'plot';
  const problems = [
    ...item.problems,
    adultRating && account.data && !account.data.adult ? `${T.site}で「18歳以上」と答えていないので、R-18とR-18Gは投稿できません。${T.site}の自分のページで変えられます` : '',
  ].filter(Boolean);
  const ready = !!account.data && problems.length === 0 && ratingOk && (!checkImages || imagesChecked) && (!needsTerms || termsOk);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['plots'] });
    qc.invalidateQueries({ queryKey: ['lorebooks'] });
    qc.invalidateQueries({ queryKey: ['sitePosts'] });
    qc.invalidateQueries({ queryKey: ['siteAccount'] });
  };
  const send = useMutation({
    mutationFn: async () => {
      if (needsTerms) await api.siteTerms(account.data!.currentTermsVersion);
      return item.post({ visibility, rating, sourceTitle, imagesChecked: checkImages && imagesChecked, target: ownOrigin ? target : 'new' });
    },
    onSuccess: (r) => {
      refresh();
      setDoneUrl(r.url);
    },
  });
  const withdraw = useMutation({
    mutationFn: () => item.withdraw(),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const images = item.images;

  return (
    <Modal
      open
      onClose={onClose}
      title={updating ? '投稿を更新' : '投稿する'}
      footer={
        doneUrl ? (
          <Button onClick={onClose}>閉じる</Button>
        ) : (
          site?.connected && (
            <>
              {updating && (
                <ConfirmButton size="md" onConfirm={() => withdraw.mutate()} disabled={withdraw.isPending} confirmLabel="もう一度押すと取り下げます">
                  取り下げる
                </ConfirmButton>
              )}
              <Button variant="primary" onClick={() => send.mutate()} disabled={!ready || send.isPending}>
                {send.isPending ? <Spinner /> : updating || (ownOrigin && target === 'update') ? '更新する' : '投稿する'}
              </Button>
            </>
          )
        )
      }
    >
      {!site?.connected ? (
        <p className="text-sm">
          先に設定の「{T.site}」で、サイトと連携してください。
          <Link to="/settings" className="text-gold-soft hover:underline">
            設定を開く
          </Link>
        </p>
      ) : doneUrl ? (
        <div className="space-y-3 text-sm">
          <p>{updating ? '更新しました。' : '投稿しました。'}</p>
          <a href={doneUrl} target="_blank" rel="noreferrer" className="text-gold-soft hover:underline">
            {doneUrl}
          </a>
        </div>
      ) : (
        <div className="space-y-5">
          <ErrorText error={account.error ?? send.error ?? withdraw.error} />
          {account.isPending && <Spinner />}
          <div className="flex gap-3">
            {item.kind === 'plot' && (item.listing.cover ? <img src={imageUrl(item.listing.cover)} alt="" className="aspect-[2/3] w-20 shrink-0 rounded object-cover" /> : <div className="aspect-[2/3] w-20 shrink-0 rounded bg-panel2" />)}
            <div className="min-w-0 text-sm">
              <div className="font-semibold">{item.title || '（無題）'}</div>
              <div className="text-dim">{item.listing.tagline}</div>
              <div className="text-xs text-gold/70">{item.listing.hashtags.map((t) => `#${t}`).join(' ')}</div>
              <div className="mt-1 text-xs text-faint">
                {me?.displayName} として投稿します。紹介文やタグは、{item.listingWhere}で直してください
              </div>
            </div>
          </div>
          {problems.map((p) => (
            <p key={p} className="text-sm text-danger">
              {p}
            </p>
          ))}
          {ownOrigin && (
            <Field label="投稿のしかた" hint={`この${what}は、前に自分が投稿したもの（${item.origin!.title}）から来ています`}>
              <Segmented value={target} onChange={setTarget} options={[{ value: 'update', label: '元の投稿を更新' }, { value: 'new', label: '新しく投稿' }]} />
            </Field>
          )}
          {remixOf && (
            <p className="text-sm text-dim">
              元の{what}: {remixOf.title || '（無題）'}（{remixOf.authorName || '作者不明'}）として表示されます
            </p>
          )}
          <Field label={T.rating}>
            <div className="space-y-2">
              <Segmented value={rating} onChange={(v) => (setRating(v), setRatingOk(false))} options={(['all', 'r18', 'r18g'] as const).map((v) => ({ value: v, label: RATING_LABELS[v] }))} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ratingOk} onChange={(e) => setRatingOk(e.target.checked)} />
                「{RATING_LABELS[rating]}」で合っていることを確かめました
              </label>
            </div>
          </Field>
          <Field label="元作品名" hint="二次創作のときだけ入れます">
            <Input value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} />
          </Field>
          <Field label="公開範囲">
            <Segmented value={visibility} onChange={setVisibility} options={[{ value: 'public', label: '公開' }, { value: 'unlisted', label: 'URLを知る人だけ' }]} />
          </Field>
          {checkImages && (
            <Field label="画像の確かめ" hint={`${T.site}に出る画像です。R-18とR-18Gでは、性器に修正が必要です`}>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {images.map((src) => (
                    <img key={src} src={imageUrl(src)} alt="" className="h-24 w-auto rounded border border-line" />
                  ))}
                  {images.length === 0 && <span className="text-xs text-faint">画像はありません</span>}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={imagesChecked} onChange={(e) => setImagesChecked(e.target.checked)} />
                  性器と結合部が輪郭ごと分からないように隠れているか、写っていないことを確かめました（小さく表示しても見えない）
                </label>
              </div>
            </Field>
          )}
          {needsTerms && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={termsOk} onChange={(e) => setTermsOk(e.target.checked)} />
              <span>
                <a href={account.data!.termsUrl} target="_blank" rel="noreferrer" className="text-gold-soft hover:underline">
                  規約とガイドライン
                </a>
                を読み、同意します（投稿した{what}は、他の人に手直しされて投稿されることがあります）
              </span>
            </label>
          )}
          {sitePost?.status === 'hidden' && <Badge tone="danger">運営が非公開にしています: {sitePost.hiddenReason}</Badge>}
        </div>
      )}
    </Modal>
  );
}
