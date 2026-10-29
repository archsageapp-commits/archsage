import { SLOT_KEYS, SLOT_LABELS, type OutfitSlot, type OutfitState, type SlotKey } from '@archsage/shared';
import { cx } from '../ui.tsx';

const small = 'h-7 w-full min-w-0 rounded bg-field border border-line px-2 text-xs text-ink placeholder:text-faint focus:outline-none focus:border-gold/60';

// 服装は、画像プロンプトに入る英語のまま見て直す
export function OutfitEditor({
  value,
  onChange,
  highlight,
  compact,
  exposure,
}: {
  value: OutfitState;
  onChange: (o: OutfitState) => void;
  highlight?: SlotKey[]; // 変わった部位
  compact?: boolean;
  exposure?: string[]; // 服装から決まる露出。渡したときだけ最後の行に出す
}) {
  const cols = compact ? 'grid-cols-[52px_1fr_18px_0.8fr] gap-1' : 'grid-cols-[64px_1fr_28px_1fr] gap-1.5';
  const set = (k: SlotKey, patch: Partial<OutfitSlot> | null) => {
    const slots = { ...value.slots };
    if (patch === null) delete slots[k];
    else slots[k] = { item: '', worn: true, state: '', ...slots[k], ...patch };
    onChange({ slots });
  };
  return (
    <div className="space-y-1">
      {/* 「着」の列は、チェックが着ている、外すと脱いだ（服の名前に取り消し線） */}
      <div className={cx('grid items-center px-0.5 text-[11px] text-faint', cols)}>
        <span>部位</span>
        <span>{compact ? '服' : '服（英語）'}</span>
        <span className="text-center" title="チェック: 着ている／外す: 脱いだ">
          着
        </span>
        <span>{compact ? '状態' : '状態（英語）'}</span>
      </div>
      {SLOT_KEYS.map((k) => {
        const s = value.slots[k];
        const has = !!s?.item;
        return (
          <div key={k} className={cx('rounded px-0.5 py-0.5', highlight?.includes(k) && 'bg-gold/10 ring-1 ring-gold/30')}>
            <div className={cx('grid items-center', cols)}>
              <span className={cx('text-xs', has ? 'text-ink/90' : 'text-faint')}>{SLOT_LABELS[k]}</span>
              <input
                className={cx(small, s && !s.worn && 'line-through text-faint')}
                value={s?.item ?? ''}
                placeholder="—"
                onChange={(e) => (e.target.value === '' && !s?.state ? set(k, null) : set(k, { item: e.target.value }))}
              />
              <input
                type="checkbox"
                className="mx-auto h-3.5 w-3.5 accent-gold"
                checked={s ? s.worn : false}
                disabled={!has}
                title={s?.worn ? '着ている（外すと脱いだことになる）' : '脱いだ（チェックで着ている）'}
                onChange={(e) => set(k, { worn: e.target.checked })}
              />
              <input className={small} value={s?.state ?? ''} placeholder={has ? '例 unbuttoned' : ''} disabled={!has} onChange={(e) => set(k, { state: e.target.value })} />
            </div>
          </div>
        );
      })}
      {exposure && (
        <div className={cx('grid items-center px-0.5 py-0.5', cols)}>
          <span className={cx('text-xs', exposure.length ? 'text-ink/90' : 'text-faint')}>露出</span>
          <span className="col-span-3 truncate px-2 text-xs text-dim" title="服装から自動で決まります">
            {exposure.length ? exposure.join(', ') : '—'}
          </span>
        </div>
      )}
    </div>
  );
}
