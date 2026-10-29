import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { T } from '../terms.ts';
import { ErrorText, Icon, Modal } from '../ui.tsx';

// シナリオの制作の入口。作り方を選んだときに初めて作るので、閉じれば空のシナリオは残らない
export function useNewPlot() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: async (how: 'wizard' | 'edit') => ({ how, plot: await api.createPlot({ title: '' }) }),
    onSuccess: ({ how, plot }) => {
      qc.invalidateQueries({ queryKey: ['plots'] });
      setOpen(false);
      nav(`/plots/${plot.id}/${how}`);
    },
  });

  const dialog = (
    <Modal open={open} onClose={() => setOpen(false)} title={T.newPlot}>
      <div className="grid gap-3 sm:grid-cols-2">
        <HowCard icon="sparkle" title={`${T.wizard}する`} disabled={create.isPending} onClick={() => create.mutate('wizard')}>
          作りたい話を書くと、AIが{T.story}、{T.character}、{T.intro}の候補を出します。選んでいくだけで形になります
        </HowCard>
        <HowCard icon="edit" title="直接編集する" disabled={create.isPending} onClick={() => create.mutate('edit')}>
          空の{T.plot}を開いて、自分で書きます。あとから{T.wizard}にも切り替えられます
        </HowCard>
      </div>
      <ErrorText error={create.error} />
    </Modal>
  );

  return { open: () => setOpen(true), dialog };
}

function HowCard({ icon, title, children, onClick, disabled }: { icon: 'sparkle' | 'edit'; title: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col gap-2 rounded-lg border border-line bg-panel2 p-4 text-left transition-colors hover:border-gold/60 disabled:opacity-50"
    >
      <span className="flex items-center gap-2 font-semibold text-gold-soft">
        <Icon name={icon} /> {title}
      </span>
      <span className="text-xs leading-relaxed text-dim">{children}</span>
    </button>
  );
}
