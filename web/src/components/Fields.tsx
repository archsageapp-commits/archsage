import { STYLE_LABELS, STYLE_OPTIONS, emptyOutfit, styleTextsFor, type Player, type StyleSettings } from '@archsage/shared';
import { Field, Input, Segmented, Select, TextArea } from '../ui.tsx';
import { OutfitEditor } from './OutfitEditor.tsx';

// キャラと主人公の挿絵の設定
export function IllustFields({ value, onChange }: { value: { sex: 'female' | 'male'; countTag: string; appearanceText?: string }; onChange: (patch: Partial<{ sex: 'female' | 'male'; countTag: string; appearanceText: string }>) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="性別">
        <Segmented
          value={value.sex}
          onChange={(v) => onChange({ sex: v, countTag: v === 'male' ? '1boy' : '1girl' })}
          options={[
            { value: 'female', label: '女性' },
            { value: 'male', label: '男性' },
          ]}
        />
      </Field>
      <Field label="人数タグ" hint="挿絵の人数（2girls など）の数え方">
        <Select value={value.countTag} onChange={(e) => onChange({ countTag: e.target.value })}>
          {['1girl', '1boy', '1other'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </Field>
      <Field label="外見の英文" className="sm:col-span-2" hint="挿絵で、この人の見た目としてそのまま使います。髪型、髪の色、目の色、体つきを英語で書き、服は入れません。例 a girl with long black hair, red eyes and a slender build">
        <TextArea rows={2} value={value.appearanceText ?? ''} onChange={(e) => onChange({ appearanceText: e.target.value })} />
      </Field>
    </div>
  );
}

export function PlayerFields({ player, onChange }: { player: Player; onChange: (fn: (p: Player) => void) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="名前" hint="{{user}} に入ります">
          <Input value={player.name} onChange={(e) => onChange((x) => void (x.name = e.target.value))} />
        </Field>
      </div>
      <Field label="説明" hint="見た目、性格、立場など。会話のプロンプトに入ります">
        <TextArea rows={4} value={player.description} onChange={(e) => onChange((x) => void (x.description = e.target.value))} />
      </Field>
      <IllustFields
        value={player}
        onChange={(patch) =>
          onChange((x) => {
            Object.assign(x, patch);
          })
        }
      />
      <div>
        <div className="mb-2 text-[13px] font-medium">初期の服装</div>
        <OutfitEditor value={player.defaultOutfit ?? emptyOutfit()} onChange={(o) => onChange((x) => void (x.defaultOutfit = o))} />
      </div>
    </div>
  );
}

export function StyleFields({ value, onChange }: { value: StyleSettings; onChange: (patch: Partial<StyleSettings>) => void }) {
  const texts = styleTextsFor(value);
  return (
    <div className="space-y-4">
      <Field label={STYLE_LABELS.replyFormat} hint={value.replyFormat === 'perLine' ? 'その場にいる人が1つずつセリフを言います' : '地の文とセリフを好きな順と数で書きます'}>
        <Segmented value={value.replyFormat} onChange={(v) => onChange({ replyFormat: v as StyleSettings['replyFormat'] })} options={STYLE_OPTIONS.replyFormat} />
      </Field>
      {value.replyFormat === 'free' && (
        <>
          {(['length', 'dialogueRatio', 'pace', 'person'] as const).map((k) => (
            <Field key={k} label={STYLE_LABELS[k]}>
              <Segmented value={value[k]} onChange={(v) => onChange({ [k]: v })} options={STYLE_OPTIONS[k]} />
            </Field>
          ))}
          <div className="rounded-md bg-panel2 px-3 py-2 text-xs leading-relaxed text-dim">
            {texts.map((t) => (
              <div key={t}>{t}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

