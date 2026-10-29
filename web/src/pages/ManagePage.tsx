import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Plot } from '@archsage/shared';
import { api, type SitePost } from '../api.ts';
import { useNewPlot } from '../components/NewPlot.tsx';
import { NewPlotTile, Pill, PlotCard, PlotGrid } from '../components/PlotCard.tsx';
import { Page } from '../Layout.tsx';
import { T } from '../terms.ts';
import { Button, ConfirmButton, ErrorText, Icon } from '../ui.tsx';

// 自分のシナリオの制作、一覧、削除。カードを押すと編集画面を開く。遊ぶ、投稿、書き出し、複製は作品の画面で行う
export function ManagePage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const plots = useQuery({ queryKey: ['plots'], queryFn: api.plots });
  const newPlot = useNewPlot();
  const fileRef = useRef<HTMLInputElement>(null);
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  // つながっていれば、自分の投稿の状態を取る。サイトで取り下げたものは手元の印も外れる
  const sitePosts = useQuery({ queryKey: ['sitePosts'], queryFn: api.sitePosts, enabled: !!settings.data?.site.connected, retry: false });
  const postOf = (p: Plot) => (p.posted ? sitePosts.data?.posts.find((x) => x.id === p.posted!.postId) : undefined);

  const imp = useMutation({
    mutationFn: (f: File) => api.importPlot(f),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['plots'] });
      nav(`/plots/${p.id}/edit`);
    },
  });
  // チャットと画像もまとめて消える
  const del = useMutation({
    mutationFn: (id: string) => api.deletePlot(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plots'] });
      qc.invalidateQueries({ queryKey: ['chats'] });
    },
  });
  const list = [...(plots.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <Page
      title={T.manage}
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) imp.mutate(f);
              e.target.value = '';
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={imp.isPending}>
            <Icon name="upload" /> 取り込む
          </Button>
          <Button variant="primary" onClick={newPlot.open}>
            <Icon name="plus" /> {T.newPlot}
          </Button>
        </>
      }
    >
      {newPlot.dialog}
      <ErrorText error={plots.error ?? imp.error ?? del.error} />
      {plots.data && list.length === 0 && <p className="mb-4 text-sm text-dim">まだ{T.plot}がありません。「{T.newPlot}」から始めるか、zipを取り込んでください。</p>}
      {plots.data && (
        <PlotGrid>
          <NewPlotTile onClick={newPlot.open} label={T.newPlot} sub={`${T.wizard}／直接編集`} />
          {list.map((p) => (
            <PlotCard
              key={p.id}
              p={p}
              to={`/plots/${p.id}/edit`}
              badges={
                <>
                  {problems(p).map((m) => (
                    <Pill key={m}>{m}</Pill>
                  ))}
                  {p.posted && <SitePill post={postOf(p)} />}
                </>
              }
              footer={
                <div className="mt-1.5 flex items-center gap-0.5">
                  <span className="mr-auto pl-0.5 text-[11px] text-faint" title={`更新 ${new Date(p.updatedAt).toLocaleString('ja-JP')}`}>
                    {new Date(p.updatedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                  </span>
                  <span title={`${T.plot}とそのチャットを消す`}>
                    <ConfirmButton variant="ghost" disabled={del.isPending} onConfirm={() => del.mutate(p.id)} confirmLabel="消す？">
                      <Icon name="trash" size={14} />
                    </ConfirmButton>
                  </span>
                </div>
              }
            />
          ))}
        </PlotGrid>
      )}
    </Page>
  );
}

function SitePill({ post }: { post?: SitePost }) {
  if (!post) return <Pill tone="gold">投稿済み</Pill>;
  if (post.status === 'hidden') return <Pill tone="danger">運営が非公開にしました</Pill>;
  return <Pill tone="gold">{post.visibility === 'public' ? '公開中' : 'URLを知る人だけ'}</Pill>;
}

// 遊び始める前に足りないもの
function problems(p: Plot): string[] {
  const out: string[] = [];
  if (p.characters.length === 0) out.push(`${T.character}がいない`);
  if (!p.intros.some((i) => i.text.trim())) out.push(`${T.intro}がない`);
  return out;
}
