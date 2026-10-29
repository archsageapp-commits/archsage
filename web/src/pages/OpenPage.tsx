import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { Page } from '../Layout.tsx';
import { RATING_LABELS, T } from '../terms.ts';
import { Badge, Button, Card, ErrorText, Spinner } from '../ui.tsx';

// サイトの「アプリで開く」から来る画面。受け取ったシナリオを見せ、取り込むかを聞く
export function OpenPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const post = params.get('post') ?? '';
  const ticket = params.get('ticket') ?? undefined;
  const fetchOne = useMutation({ mutationFn: () => api.siteOpen(post, ticket) });
  const take = useMutation({
    mutationFn: (key: string) => api.siteImport(key),
    onSuccess: (r) => {
      if ('lorebook' in r) {
        qc.invalidateQueries({ queryKey: ['lorebooks'] });
        nav(`/lorebooks?id=${r.lorebook.id}`, { replace: true });
        return;
      }
      qc.invalidateQueries({ queryKey: ['plots'] });
      nav(`/plots/${r.plot.id}`, { replace: true });
    },
  });
  // 引換券は1回しか使えないので、受け取りは一度だけにする
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetchOne.mutate();
  }, [fetchOne]);
  const pv = fetchOne.data;

  return (
    <Page title={`${T.site}から開く`} narrow>
      {fetchOne.isPending && (
        <div className="flex items-center gap-2 text-dim">
          <Spinner /> {T.site}から受け取っています
        </div>
      )}
      <ErrorText error={fetchOne.error ?? take.error} />
      {pv && (
        <Card className="flex gap-4 p-4">
          {pv.cover && <img src={pv.cover} alt="" className="aspect-[2/3] w-36 shrink-0 rounded-lg object-cover" />}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{pv.title || '（無題）'}</h2>
              {pv.rating !== 'all' && <Badge tone="danger">{RATING_LABELS[pv.rating]}</Badge>}
            </div>
            <div className="text-sm text-dim">作者: {pv.authorName || '不明'}</div>
            <p className="text-sm">{pv.tagline}</p>
            {pv.kind === 'lorebook' ? (
              <p className="text-xs text-faint">
                {T.lorebook}です（項目 {pv.entries ?? 0}）。取り込むと{T.lorebook}の画面に入るので、使う{T.plot}の編集画面の「{T.lorebook}」タブで選んでください。サイトで更新や取り下げがあっても、手元の{T.lorebook}は変わりません。
              </p>
            ) : (
              <p className="text-xs text-faint">取り込むと、{T.manage}に別の{T.plot}として入ります。サイトで更新や取り下げがあっても、手元の{T.plot}は変わりません。</p>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="primary" onClick={() => take.mutate(pv.key)} disabled={take.isPending}>
                取り込む
              </Button>
              <Button onClick={() => nav('/', { replace: true })}>やめる</Button>
            </div>
          </div>
        </Card>
      )}
    </Page>
  );
}
