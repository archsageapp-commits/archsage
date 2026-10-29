import { useEffect, useState } from 'react';
import { imageUrl } from '../api.ts';
import { Icon } from '../ui.tsx';

export interface LightboxItem {
  file: string;
  prompt?: string;
  negative?: string;
  seed?: number;
}

// 過去の画像を左右で遡る
export function Lightbox({ items, index, onClose }: { items: LightboxItem[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const [showPrompt, setShowPrompt] = useState(false);
  useEffect(() => setI(index), [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);
  const item = items[i];
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onMouseDown={onClose}>
      <div className="flex items-center justify-between px-4 py-2 text-sm text-white/70" onMouseDown={(e) => e.stopPropagation()}>
        <span>
          {i + 1} / {items.length}
        </span>
        <div className="flex items-center gap-3">
          <button type="button" className="hover:text-white" onClick={() => setShowPrompt(!showPrompt)}>
            プロンプト
          </button>
          <a href={imageUrl(item.file)} download className="hover:text-white">
            <Icon name="download" />
          </a>
          <button type="button" onClick={onClose} className="hover:text-white" aria-label="閉じる">
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-4">
        <button
          type="button"
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-20"
          disabled={i === 0}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setI(i - 1)}
          aria-label="前の画像"
        >
          <Icon name="left" size={28} />
        </button>
        <img src={imageUrl(item.file)} alt="" className="max-h-full max-w-full rounded object-contain shadow-2xl" onMouseDown={(e) => e.stopPropagation()} />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-20"
          disabled={i === items.length - 1}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setI(i + 1)}
          aria-label="次の画像"
        >
          <Icon name="right" size={28} />
        </button>
        {showPrompt && (
          <div className="absolute bottom-6 left-1/2 max-h-[40%] w-[min(800px,90%)] -translate-x-1/2 overflow-y-auto rounded-lg border border-line bg-panel/95 p-3 text-xs leading-relaxed" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mb-1 text-faint">プロンプト{item.seed !== undefined && `（seed ${item.seed}）`}</div>
            <div className="mb-2 select-text whitespace-pre-wrap">{item.prompt}</div>
            <div className="mb-1 text-faint">ネガティブ</div>
            <div className="select-text whitespace-pre-wrap text-dim">{item.negative}</div>
          </div>
        )}
      </div>
    </div>
  );
}
