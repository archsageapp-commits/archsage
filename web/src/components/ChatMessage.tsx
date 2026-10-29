import { useState } from 'react';
import { USER_ID, partsToText, type ImageRef, type Message, type ReplyPart } from '@archsage/shared';
import { imageUrl } from '../api.ts';
import { T } from '../terms.ts';
import { Button, ConfirmButton, cx, Icon, Spinner, TextArea } from '../ui.tsx';

export interface People {
  nameOf: (id: string) => string;
  avatarOf: (id: string) => string | undefined;
  playerName: string;
}

function Avatar({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  return src ? (
    <img src={imageUrl(src)} alt="" className="shrink-0 rounded-full border border-line object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="flex shrink-0 items-center justify-center rounded-full border border-line bg-panel2 text-sm text-dim" style={{ width: size, height: size }}>
      {name.slice(0, 1) || '?'}
    </div>
  );
}

const STATUS_LABEL: Record<ImageRef['status'], string> = {
  queued: '順番待ち',
  prompting: `${T.illust}の準備中`,
  generating: '生成中',
  done: '',
  error: '失敗',
};

function ImageSlot({ images, onOpen, onReseed, onRedo, onDelete, onLoad }: { images: ImageRef[]; onOpen: (file: string) => void; onReseed: (img: ImageRef) => void; onRedo: () => void; onDelete: (img: ImageRef) => void; onLoad?: () => void }) {
  const [sel, setSel] = useState<number | null>(null);
  if (images.length === 0) return null;
  const idx = sel !== null && sel < images.length ? sel : images.length - 1;
  const img = images[idx];
  const working = img.status !== 'done' && img.status !== 'error';
  return (
    <div className="mt-3">
      <div className="group relative inline-block max-w-full overflow-hidden rounded-lg border border-line bg-panel2">
        {img.status === 'done' && img.file ? (
          <button type="button" onClick={() => onOpen(img.file as string)} className="block">
            <img src={imageUrl(img.file)} alt="" onLoad={onLoad} className="max-h-[520px] w-auto max-w-full object-contain" />
          </button>
        ) : (
          <div className="flex h-60 w-[320px] max-w-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-dim">
            {working ? <Spinner className="h-6 w-6 text-gold" /> : <Icon name="image" size={28} className="text-danger" />}
            <div>{STATUS_LABEL[img.status]}</div>
            {img.status === 'generating' && (
              <div className="h-1.5 w-48 overflow-hidden rounded-full bg-panel2">
                <div className="h-full bg-gold transition-[width] duration-300" style={{ width: `${Math.round((img.progress ?? 0) * 100)}%` }} />
              </div>
            )}
            {img.status === 'error' && <div className="line-clamp-4 text-xs text-danger">{img.error}</div>}
          </div>
        )}
        {!working && (
          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {img.prompt && (
              <Button size="sm" variant="overlay" onClick={() => onReseed(img)} title="同じプロンプトで、別のシードで描き直す">
                <Icon name="dice" size={13} />
              </Button>
            )}
            <Button size="sm" variant="overlay" onClick={onRedo} title="場面を読み直して作り直す">
              <Icon name="refresh" size={13} />
            </Button>
            <ConfirmButton size="sm" variant="overlay" onConfirm={() => onDelete(img)} confirmLabel="消す？">
              <Icon name="trash" size={13} />
            </ConfirmButton>
          </div>
        )}
      </div>
      {images.length > 1 && (
        <div className="mt-1 flex gap-1">
          {images.map((x, i) => (
            <button key={x.id} type="button" onClick={() => setSel(i)} className={cx('h-1.5 w-5 rounded-full', i === idx ? 'bg-gold' : 'bg-panel2 hover:bg-line')} aria-label={`${i + 1}枚目`} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Parts({ parts, people }: { parts: ReplyPart[]; people: People }) {
  return (
    <div className="space-y-2.5">
      {parts.map((p, i) => {
        if (p.kind === 'narration') {
          return (
            <p key={i} className="whitespace-pre-wrap text-[14.5px] leading-[1.85] text-ink/80">
              {p.text}
            </p>
          );
        }
        const name = p.speaker ? people.nameOf(p.speaker) : (p.speakerName ?? '');
        const isUser = p.speaker === USER_ID;
        return (
          <div key={i} className="flex items-start gap-2.5">
            <Avatar src={p.speaker ? people.avatarOf(p.speaker) : undefined} name={name} />
            <div className="min-w-0">
              <div className={cx('mb-0.5 text-xs', isUser ? 'text-gold/80' : 'text-dim')}>{name}</div>
              <div className="inline-block whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-line bg-panel2 px-3.5 py-2 text-[14.5px] leading-relaxed">{p.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ChatMessage({
  message,
  people,
  canRegenerate,
  busy,
  onSwipe,
  onRegenerate,
  onEdit,
  onDelete,
  onIllustrate,
  onReseed,
  onDeleteImage,
  onOpenImage,
  onImageLoad,
  novel,
}: {
  message: Message;
  people: People;
  canRegenerate: boolean;
  busy: boolean;
  onSwipe: (i: number) => void;
  onRegenerate: () => void;
  onEdit: (text: string, instruction?: string) => void; // 指示は利用者の発言のときだけ渡す
  onDelete: (swipe?: number) => void;
  onIllustrate: () => void;
  onReseed: (img: ImageRef) => void;
  onDeleteImage: (img: ImageRef) => void;
  onOpenImage: (file: string) => void;
  onImageLoad?: () => void;
  novel?: boolean; // 小説モードでは利用者の発言は指示として見せる
}) {
  const swipe = message.swipes[message.activeSwipe] ?? message.swipes[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftInstruction, setDraftInstruction] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const text = swipe?.parts?.length ? partsToText(swipe.parts, people.nameOf) : (swipe?.text ?? '');
  const n = message.swipes.length;

  const startEdit = () => {
    setDraft(text);
    setDraftInstruction(swipe?.instruction ?? '');
    setEditing(true);
  };

  const tools = (
    <div className="mt-1.5 flex flex-wrap items-center gap-0.5 text-dim opacity-60 transition-opacity group-hover:opacity-100">
      {message.role === 'assistant' && (n > 1 || canRegenerate) && (
        <div className="mr-1 flex items-center">
          <Button size="sm" variant="ghost" disabled={message.activeSwipe === 0 || busy} onClick={() => onSwipe(message.activeSwipe - 1)} aria-label="前の返答">
            <Icon name="left" size={14} />
          </Button>
          <span className="min-w-8 text-center text-xs tabular-nums">
            {message.activeSwipe + 1}/{n}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || (message.activeSwipe === n - 1 && !canRegenerate)}
            onClick={() => (message.activeSwipe === n - 1 ? onRegenerate() : onSwipe(message.activeSwipe + 1))}
            aria-label="次の返答"
          >
            <Icon name="right" size={14} />
          </Button>
        </div>
      )}
      {message.role === 'assistant' && canRegenerate && (
        <Button size="sm" variant="ghost" onClick={onRegenerate} disabled={busy}>
          <Icon name="refresh" size={13} /> {T.regenerate}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={startEdit} disabled={busy}>
        <Icon name="edit" size={13} /> 編集
      </Button>
      {message.role === 'assistant' && (
        <Button size="sm" variant="ghost" onClick={onIllustrate} title={`${T.illust}を作る`}>
          <Icon name="image" size={13} /> {T.illust}
        </Button>
      )}
      {n > 1 ? (
        <ConfirmButton variant="ghost" onConfirm={() => onDelete(message.activeSwipe)} confirmLabel="この返答を消す？">
          <Icon name="trash" size={13} />
        </ConfirmButton>
      ) : (
        <ConfirmButton variant="ghost" onConfirm={() => onDelete()} confirmLabel="消す？">
          <Icon name="trash" size={13} />
        </ConfirmButton>
      )}
    </div>
  );

  const editor = editing && (
    <div className="space-y-2">
      <TextArea autoGrow rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
      {message.role === 'assistant' && <div className="text-xs text-faint">「名前「セリフ」」の行が吹き出しになります</div>}
      {message.role === 'user' && (
        <div className="space-y-1 text-left">
          <div className="text-xs font-medium text-gold-soft">{T.instruction}</div>
          <TextArea autoGrow rows={2} value={draftInstruction} onChange={(e) => setDraftInstruction(e.target.value)} placeholder="なし" />
          <div className="text-xs text-faint">次の返答を{T.regenerate}ときに使います</div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            onEdit(draft, message.role === 'user' ? draftInstruction : undefined);
            setEditing(false);
          }}
        >
          保存
        </Button>
        <Button size="sm" onClick={() => setEditing(false)}>
          やめる
        </Button>
      </div>
    </div>
  );

  if (message.role === 'user') {
    return (
      <div className="group flex justify-end">
        <div className="max-w-[78%]">
          {editing ? (
            editor
          ) : (
            <>
              {swipe.text && novel && (
                <div className="text-right">
                  <span className="inline-block whitespace-pre-wrap rounded-lg border border-dashed border-gold/30 px-3 py-1.5 text-left text-sm text-dim">
                    <span className="mr-2 text-xs text-gold/80">指示</span>
                    {swipe.text}
                  </span>
                </div>
              )}
              {swipe.text && !novel && (
                <div className="flex items-start justify-end gap-2.5">
                  <div className="text-right">
                    <div className="mb-0.5 text-xs text-gold/80">{people.playerName}</div>
                    <div className="inline-block whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-gold/12 px-3.5 py-2 text-left text-[14.5px] leading-relaxed ring-1 ring-gold/20">{swipe.text}</div>
                  </div>
                  <Avatar src={people.avatarOf(USER_ID)} name={people.playerName} />
                </div>
              )}
              {swipe.instruction && (
                <div className="mt-1 text-right text-xs text-dim">
                  <span className="rounded border border-line px-1.5 py-0.5">
                    {T.instruction}: {swipe.instruction}
                  </span>
                </div>
              )}
              <div className="flex justify-end">{tools}</div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      {editing ? (
        editor
      ) : swipe?.error ? (
        <div className="space-y-2 rounded-lg border border-danger-line bg-danger-bg/50 p-3 text-sm">
          <div className="text-danger">{swipe.error}</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={onRegenerate} disabled={busy}>
              <Icon name="refresh" size={13} /> {T.regenerate}
            </Button>
            {swipe.raw && (
              <Button size="sm" variant="ghost" onClick={() => setShowRaw(!showRaw)}>
                受け取った文章を見る
              </Button>
            )}
          </div>
          {showRaw && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line bg-field p-2 text-xs text-dim">{swipe.raw}</pre>}
        </div>
      ) : swipe?.parts?.length ? (
        <Parts parts={swipe.parts} people={people} />
      ) : (
        <p className="whitespace-pre-wrap leading-[1.85]">{swipe?.text}</p>
      )}
      <ImageSlot images={swipe?.images ?? []} onOpen={onOpenImage} onReseed={onReseed} onRedo={onIllustrate} onDelete={onDeleteImage} onLoad={onImageLoad} />
      {swipe?.stopped && !editing && <div className="mt-2 text-xs text-faint">途中で止めました（場面の状態は前のままです）</div>}
      {!editing && tools}
    </div>
  );
}
