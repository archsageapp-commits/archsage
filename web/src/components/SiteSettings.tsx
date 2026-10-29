import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { T } from '../terms.ts';
import { Badge, Button, Card, ErrorText, Field, Icon, Input } from '../ui.tsx';
import type { DraftSettings } from './SettingsParts.tsx';

// 投稿サイトの URL と、サイトとの連携。連携はブラウザで行い、戻ってきたら設定を読み直す
export function SiteSettings({ s, set }: { s: DraftSettings; set: (fn: (s: DraftSettings) => void) => void }) {
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const saved = useQuery({ queryKey: ['settings'], queryFn: api.settings, refetchInterval: waiting ? 2000 : false });
  const live = saved.data?.site;
  useEffect(() => {
    if (waiting && live?.connected) setWaiting(false);
  }, [waiting, live?.connected]);
  const disconnect = useMutation({
    mutationFn: api.siteDisconnect,
    onSuccess: (next) => qc.setQueryData(['settings'], next),
  });
  const unsaved = s.site.url !== live?.url;

  return (
    <div className="space-y-4">
      <p className="text-sm text-dim">
        {T.plot}を{T.site}に投稿するときに使います。遊ぶだけなら、連携しなくても{T.site}の「アプリで開く」で取り込めます。
      </p>
      <Card className="space-y-4 p-4">
        <Field label="サイトの URL" hint={unsaved ? 'URL を変えたら、先に右上の「保存」を押してください。前のサイトとの連携は外れます' : undefined}>
          <Input value={s.site.url} onChange={(e) => set((d) => void (d.site.url = e.target.value))} placeholder="https://…" />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          {live?.connected ? (
            <>
              <Badge tone="ok">連携しています</Badge>
              <span className="text-sm">{live.user?.displayName} として投稿します</span>
              <Button size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                連携を外す
              </Button>
            </>
          ) : (
            <>
              {/* いつものブラウザで開く。Electron でも /site/ の下は外のブラウザに渡る */}
              {unsaved ? (
                <Button variant="primary" disabled>
                  <Icon name="send" size={14} /> サイトと連携する
                </Button>
              ) : (
                <a href="/site/connect/start" target="_blank" rel="noreferrer" onClick={() => setWaiting(true)}>
                  <Button variant="primary">
                    <Icon name="send" size={14} /> サイトと連携する
                  </Button>
                </a>
              )}
              {waiting && <span className="text-sm text-dim">ブラウザでログインして「許可する」を押すと、ここに戻って連携が終わります</span>}
            </>
          )}
        </div>
        <ErrorText error={disconnect.error} />
      </Card>
    </div>
  );
}
