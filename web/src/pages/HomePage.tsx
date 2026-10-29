import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, imageUrl } from '../api.ts';
import { useNewPlot } from '../components/NewPlot.tsx';
import { NewPlotTile, PlotCard, PlotGrid } from '../components/PlotCard.tsx';
import { Page } from '../Layout.tsx';
import { T } from '../terms.ts';
import { Button, ErrorText, Icon } from '../ui.tsx';

// ホームは遊ぶための場所。一覧の整理や削除はシナリオ管理で行う
export function HomePage() {
  const qc = useQueryClient();
  const plots = useQuery({ queryKey: ['plots'], queryFn: api.plots });
  const chats = useQuery({ queryKey: ['chats'], queryFn: () => api.chats() });
  const newPlot = useNewPlot();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const sample = useMutation({
    mutationFn: api.addSample,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plots'] }),
  });

  const plotOf = (id: string) => plots.data?.find((p) => p.id === id);

  return (
    <Page title="ホーム">
      {newPlot.dialog}
      <ErrorText error={plots.error ?? sample.error} />

      {chats.data && chats.data.length > 0 && (
        <Section title="続きから">
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {chats.data.slice(0, 5).map((c) => {
              const p = plotOf(c.plotId);
              return (
                <Link key={c.id} to={`/chats/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel2">
                  {p?.listing.cover ? <img src={imageUrl(p.listing.cover)} alt="" className="h-9 w-7 shrink-0 rounded object-cover" /> : <Icon name="chat" className="text-faint" />}
                  <span className="min-w-0 flex-1 truncate">{c.title || p?.title || '（無題）'}</span>
                  <span className="hidden truncate text-xs text-faint sm:inline">{p?.title || '（無題）'}</span>
                  <span className="w-28 shrink-0 text-right text-xs text-faint">{new Date(c.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </Link>
              );
            })}
          </div>
        </Section>
      )}

      <Section
        title={`あなたの${T.plot}`}
        right={
          <div className="flex items-center gap-3">
            {plots.data?.length === 0 && (
              <Button size="sm" variant="ghost" onClick={() => sample.mutate()} disabled={sample.isPending}>
                <Icon name="sparkle" size={13} /> サンプルを入れる
              </Button>
            )}
            <Link to="/manage" className="text-xs text-dim hover:text-ink">
              {T.manage}へ
            </Link>
          </div>
        }
      >
        <PlotGrid>
          <NewPlotTile onClick={newPlot.open} label={T.newPlot} sub={`${T.wizard}／直接編集`} />
          {plots.data?.map((p) => (
            <PlotCard
              key={p.id}
              p={p}
              to={`/plots/${p.id}`}
              corner={
                <Link to={`/plots/${p.id}/edit`} title="編集" className="flex h-7 w-7 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm hover:bg-black/75">
                  <Icon name="edit" size={13} />
                </Link>
              }
            />
          ))}
        </PlotGrid>
      </Section>

      <Section title={`${T.site}の${T.plot}`}>
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-panel p-4">
          <p className="min-w-0 flex-1 text-sm text-dim">
            {T.site}で{T.plot}を探して「アプリで開く」を押すと、ここに取り込めます。
          </p>
          {settings.data?.site.url && (
            <a href={settings.data.site.url} target="_blank" rel="noreferrer">
              <Button>
                <Icon name="send" size={13} /> {T.site}を開く
              </Button>
            </a>
          )}
        </div>
      </Section>
    </Page>
  );
}

function Section({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-dim">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
