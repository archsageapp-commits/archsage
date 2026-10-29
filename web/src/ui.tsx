import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle' | 'overlay';

export function Button({ variant = 'subtle', size = 'md', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const v = {
    primary: 'bg-gold text-on-gold hover:bg-gold-soft font-medium',
    subtle: 'bg-panel2 text-ink border border-line hover:border-line-strong hover:bg-hover',
    ghost: 'text-dim hover:text-ink hover:bg-panel2',
    danger: 'bg-transparent text-danger border border-danger-line hover:bg-danger-bg',
    // 画像の上に重ねるボタン。絵の色にかかわらず読めるよう、暗い下地に白い文字
    overlay: 'bg-black/55 text-white border border-white/15 hover:bg-black/75',
  }[variant];
  const s = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1' : 'h-9 px-3.5 text-sm gap-1.5';
  return (
    <button
      type="button"
      className={cx('inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap', v, s, className)}
      {...rest}
    />
  );
}

const fieldBase =
  'w-full rounded-md bg-field border border-line px-3 text-ink placeholder:text-faint focus:outline-none focus:border-gold/60 focus:ring-2 focus:ring-gold/15 transition-colors';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(fieldBase, 'h-9', className)} {...rest} />;
}

export function TextArea({ className, autoGrow, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoGrow || !ref.current) return;
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 480)}px`;
  }, [autoGrow, rest.value]);
  return <textarea ref={ref} className={cx(fieldBase, 'py-2 leading-relaxed', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, 'h-9 pr-8 appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat', className)} style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%239aa0ad' stroke-width='1.5'/%3E%3C/svg%3E")` }} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className, right }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <label className={cx('block', className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-ink/90">{label}</span>
        {right}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2 select-none', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-gold' : 'bg-track')}
      >
        <span className={cx('absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </button>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}

export function Segmented<V extends string>({ value, options, onChange, size = 'md' }: { value: V; options: { value: V; label: ReactNode }[]; onChange: (v: V) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-panel2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-[5px] transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
            value === o.value ? 'bg-field text-gold font-medium shadow-sm ring-1 ring-line' : 'text-dim hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<K extends string>({ tabs, value, onChange, className }: { tabs: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div className={cx('flex gap-1 border-b border-line overflow-x-auto overflow-y-hidden', className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cx(
            '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
            value === t.key ? 'border-gold text-ink' : 'border-transparent text-dim hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={cx('flex max-h-[90vh] w-full flex-col rounded-xl border border-line bg-panel shadow-2xl', wide ? 'max-w-5xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-dim hover:text-ink" aria-label="閉じる">
            <Icon name="x" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg border border-line bg-panel', className)}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-dim">{children}</div>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-md border border-danger-line bg-danger-bg/60 px-3 py-2 text-sm text-danger">{(error as Error).message ?? String(error)}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

export function Badge({ children, tone = 'dim' }: { children: ReactNode; tone?: 'dim' | 'gold' | 'ok' | 'danger' }) {
  const t = {
    dim: 'bg-panel2 text-dim border-line',
    gold: 'bg-gold/10 text-gold border-gold/30',
    ok: 'bg-ok/10 text-ok border-ok/30',
    danger: 'bg-danger/10 text-danger border-danger/30',
  }[tone];
  return <span className={cx('inline-flex items-center rounded border px-1.5 py-px text-[11px] leading-4', t)}>{children}</span>;
}

// 線画のアイコン。外部の画像を読み込まないよう、ここで描く
const ICONS: Record<string, string> = {
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  home: 'M4 11l8-7 8 7v9a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0',
  book: 'M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h10',
  scroll: 'M8 4h11v13a3 3 0 01-3 3H6a2 2 0 01-2-2v-2h12M8 4a2 2 0 00-2 2v10M8 4a2 2 0 012 2v1H6',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2.2-1.3L14.4 3h-4l-.4 2.4a7.6 7.6 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002.2 1.3l.4 2.4h4l.4-2.4a7.6 7.6 0 002.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z',
  send: 'M4 12l16-8-6 16-2-7z',
  stop: 'M7 7h10v10H7z',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  dice: 'M5 5h14v14H5zM9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  lock: 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z',
  unlock: 'M7 11V8a5 5 0 019.6-2M6 11h12v9H6z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
  chat: 'M4 5h16v11H9l-5 4z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14',
  upload: 'M12 20V9m0 0l-4 4m4-4l4 4M5 5h14',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  check: 'M5 12l5 5 9-10',
  play: 'M7 5l12 7-12 7z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  panel: 'M4 5h16v14H4zM15 5v14',
  wand: 'M5 19L15 9M13 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.6 1.4L21 13l-1.4.6L19 15l-.6-1.4L17 13l1.4-.6z',
};

export function Icon({ name, className, size = 16 }: { name: keyof typeof ICONS | string; className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useUid(): string {
  return useId();
}

// 1回目で「もう一度押すと消えます」に変わり、2回目で実行する。確認ダイアログは使わない
export function ConfirmButton({ onConfirm, children, confirmLabel = 'もう一度押すと消えます', size = 'sm', variant = 'danger', className, disabled }: { onConfirm: () => void; children: ReactNode; confirmLabel?: ReactNode; size?: 'sm' | 'md'; variant?: Variant; className?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      size={size}
      variant={armed ? 'danger' : variant}
      className={cx(armed && 'bg-danger-bg', className)}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}

export function TagsInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft
      .split(/[,、\n]/)
      .map((s) => s.trim().replace(/^#/, ''))
      .filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setDraft('');
  };
  return (
    <div className={cx(fieldBase, 'flex min-h-9 flex-wrap items-center gap-1.5 py-1.5')}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-panel2 px-2 py-0.5 text-xs">
          {t}
          <button type="button" className="text-faint hover:text-ink" onClick={() => onChange(value.filter((x) => x !== t))} aria-label="消す">
            ×
          </button>
        </span>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent text-sm outline-none"
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
      />
    </div>
  );
}
