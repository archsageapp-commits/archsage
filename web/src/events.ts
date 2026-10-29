import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ImageRef, ReplyPart } from '@archsage/shared';
import type { ChatView } from './api.ts';

type AppEvent =
  | { type: 'message'; chatId: string; messageId: string }
  | { type: 'image'; chatId: string; messageId: string; swipeIndex: number; imageId: string; status: ImageRef['status']; progress?: number }
  | { type: 'summary'; chatId: string }
  | { type: 'plot'; plotId: string }
  | { type: 'busy'; chatId: string; busy: boolean }
  | { type: 'draft'; chatId: string; parts: ReplyPart[]; thinking: boolean };

// 書いている途中の返答。['draft', chatId] に置き、書き終わったら消す
export interface Draft {
  parts: ReplyPart[];
  thinking: boolean;
}

export function clearDraft(qc: QueryClient, chatId: string): void {
  qc.setQueryData<Draft | null>(['draft', chatId], null);
}

const ORDER: Record<ImageRef['status'], number> = { queued: 0, prompting: 1, generating: 2, done: 3, error: 3 };

// 進捗はキャッシュの中だけを書き換え、状態が変わったときに読み直す。状態が後戻りする上書きは防ぐ
function applyImageEvent(qc: QueryClient, e: Extract<AppEvent, { type: 'image' }>): boolean {
  let needsRefetch = true;
  qc.setQueryData<ChatView>(['chat', e.chatId], (view) => {
    if (!view) return view;
    const messages = view.messages.map((m) => {
      if (m.id !== e.messageId) return m;
      const swipes = m.swipes.map((s, i) => {
        if (i !== e.swipeIndex) return s;
        const images = s.images.map((img) => {
          if (img.id !== e.imageId) return img;
          if (ORDER[e.status] < ORDER[img.status]) return img;
          if (img.status === e.status && e.status === 'generating') needsRefetch = false;
          return { ...img, status: e.status, progress: e.progress ?? img.progress };
        });
        return { ...s, images };
      });
      return { ...m, swipes };
    });
    return { ...view, messages };
  });
  return needsRefetch;
}

export function useAppEvents(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | undefined;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      es = new EventSource('/api/events');
      es.onmessage = (ev) => {
        let e: AppEvent;
        try {
          e = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (e.type === 'image') {
          if (applyImageEvent(qc, e)) qc.invalidateQueries({ queryKey: ['chat', e.chatId] });
        } else if (e.type === 'message' || e.type === 'summary') {
          qc.invalidateQueries({ queryKey: ['chat', e.chatId] });
        } else if (e.type === 'busy') {
          qc.setQueryData<ChatView>(['chat', e.chatId], (v) => (v ? { ...v, busy: e.busy } : v));
          // 書き終わった返答を読み込んでから、途中の表示を消す（一瞬空になるのを防ぐ）
          if (!e.busy) void qc.invalidateQueries({ queryKey: ['chat', e.chatId] }).then(() => clearDraft(qc, e.chatId));
        } else if (e.type === 'draft') {
          const draft: Draft = { parts: e.parts, thinking: e.thinking };
          qc.setQueryData(['draft', e.chatId], draft);
        } else if (e.type === 'plot') {
          qc.invalidateQueries({ queryKey: ['plot', e.plotId] });
        }
      };
      es.onerror = () => {
        es?.close();
        if (!closed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [qc]);
}
