// 画面へ送るイベント。挿絵の進捗などを SSE で流す

import type { ReplyPart } from '@archsage/shared';

export type AppEvent =
  | { type: 'message'; chatId: string; messageId: string }
  | { type: 'image'; chatId: string; messageId: string; swipeIndex: number; imageId: string; status: string; progress?: number }
  | { type: 'summary'; chatId: string }
  | { type: 'plot'; plotId: string }
  | { type: 'busy'; chatId: string; busy: boolean }
  // 書いている途中の返答。thinking は考える過程を書いていて、本文がまだないとき
  | { type: 'draft'; chatId: string; parts: ReplyPart[]; thinking: boolean };

type Listener = (e: AppEvent) => void;

export class EventHub {
  listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: AppEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {
        // 1つの購読先の失敗で他を止めない
      }
    }
  }
}

// 同じキーの処理を前のものが終わってから始める（直列）
export class SerialQueue {
  tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.tails.set(key, next);
    next
      .finally(() => {
        if (this.tails.get(key) === next) this.tails.delete(key);
      })
      .catch(() => undefined);
    return next;
  }

  busy(key: string): boolean {
    return this.tails.has(key);
  }
}
