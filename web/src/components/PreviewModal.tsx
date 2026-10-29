import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { T } from '../terms.ts';
import { Badge, cx, ErrorText, Modal, Spinner, Tabs } from '../ui.tsx';

function MessagesView({ messages }: { messages: { role: string; content: string }[] }) {
  return (
    <div className="space-y-3">
      {messages.map((m, i) => (
        <div key={i} className="rounded-md border border-line">
          <div className={cx('border-b border-line px-3 py-1 text-[11px] font-medium uppercase tracking-wider', m.role === 'system' ? 'text-gold' : m.role === 'user' ? 'text-ok' : 'text-dim')}>{m.role}</div>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-xs leading-relaxed select-text">{m.content}</pre>
        </div>
      ))}
    </div>
  );
}

const KIND: Record<string, string> = { chat: '会話', illust: T.illust, summary: T.summary };

export function PreviewModal({ chatId, open, onClose, text, instruction }: { chatId: string; open: boolean; onClose: () => void; text: string; instruction: string }) {
  const [tab, setTab] = useState<'next' | 'recent'>('next');
  const preview = useQuery({ queryKey: ['preview', chatId, text, instruction], queryFn: () => api.preview(chatId, { text, instruction }), enabled: open && tab === 'next' });
  const recent = useQuery({ queryKey: ['requests', chatId], queryFn: () => api.requests(chatId), enabled: open && tab === 'recent' });
  const [sel, setSel] = useState(0);
  return (
    <Modal open={open} onClose={onClose} title={T.preview} wide>
      <Tabs
        className="-mt-2 mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'next', label: '次に送る内容' },
          { key: 'recent', label: '直近の送信と返答' },
        ]}
      />
      {tab === 'next' && (
        <>
          {preview.isLoading && <Spinner />}
          <ErrorText error={preview.error} />
          {preview.data && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
                <span>
                  約{preview.data.tokens.total.toLocaleString()}トークン（システム {preview.data.tokens.system.toLocaleString()}・履歴 {preview.data.tokens.history.toLocaleString()} / 履歴に使える量 {preview.data.tokens.budget.toLocaleString()}）
                </span>
                {preview.data.droppedMessages > 0 && <Badge tone="danger">古い発言 {preview.data.droppedMessages}件は入りません</Badge>}
                {preview.data.needsSummary && <Badge tone="gold">次の返答の後に{T.summary}を作ります</Badge>}
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-dim">発動した{T.lorebook}</div>
                {preview.data.activatedLore.length === 0 ? (
                  <div className="text-xs text-faint">なし</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {preview.data.activatedLore.map((a) => (
                      <Badge key={a.entry.id} tone="gold">
                        {a.lorebookName}: {a.entry.constant ? '常時' : a.entry.keys.join('、')}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <MessagesView messages={preview.data.messages} />
            </div>
          )}
        </>
      )}
      {tab === 'recent' && (
        <>
          {recent.isLoading && <Spinner />}
          {recent.data && recent.data.length === 0 && <div className="text-sm text-dim">まだ送信していません（アプリを起動し直すと消えます）</div>}
          {recent.data && recent.data.length > 0 && (
            <div className="grid gap-4 md:grid-cols-[180px_1fr]">
              <div className="space-y-1">
                {recent.data.map((r, i) => (
                  <button key={i} type="button" onClick={() => setSel(i)} className={cx('w-full rounded px-2 py-1.5 text-left text-xs', sel === i ? 'bg-panel2 text-ink' : 'text-dim hover:bg-panel2')}>
                    {KIND[r.kind]} {new Date(r.at).toLocaleTimeString('ja-JP')}
                    {r.error && <span className="ml-1 text-danger">失敗</span>}
                  </button>
                ))}
              </div>
              {recent.data[sel] && (
                <div className="min-w-0 space-y-3">
                  {recent.data[sel].error && <ErrorText error={new Error(recent.data[sel].error)} />}
                  {recent.data[sel].raw !== undefined && (
                    <div className="rounded-md border border-gold/30">
                      <div className="border-b border-gold/30 px-3 py-1 text-[11px] font-medium text-gold">受け取った生の文章</div>
                      <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-xs select-text">{recent.data[sel].raw}</pre>
                    </div>
                  )}
                  <MessagesView messages={recent.data[sel].messages} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
