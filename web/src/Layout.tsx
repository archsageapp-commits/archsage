import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { useAppEvents } from './events.ts';
import { T } from './terms.ts';
import { cx, Icon } from './ui.tsx';

const NAV = [
  { to: '/', label: 'ホーム', icon: 'home', end: true },
  { to: '/manage', label: T.manage, icon: 'edit' },
  { to: '/lorebooks', label: T.lorebook, icon: 'book' },
  { to: '/prompts', label: T.prompts, icon: 'scroll' },
  { to: '/settings', label: '設定', icon: 'gear' },
];

export function Layout() {
  useAppEvents();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const loc = useLocation();
  const nav = useNavigate();

  // 初回は案内へ
  useEffect(() => {
    if (settings.data && !settings.data.onboarded && loc.pathname === '/') nav('/setup');
  }, [settings.data, loc.pathname, nav]);

  return (
    <div className="flex h-full">
      <aside className="flex w-[60px] shrink-0 flex-col items-center gap-1 border-r border-line bg-side py-3 lg:w-[188px] lg:items-stretch lg:px-3">
        <div className="mb-4 flex items-center gap-2 px-1 lg:px-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <div className="hidden text-[15px] font-semibold tracking-wide text-gold-soft lg:block">Archsage</div>
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            title={n.label}
            className={({ isActive }) =>
              cx(
                'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors',
                isActive ? 'bg-panel2 text-gold' : 'text-dim hover:bg-panel hover:text-ink',
              )
            }
          >
            <Icon name={n.icon} size={18} />
            <span className="hidden lg:inline">{n.label}</span>
          </NavLink>
        ))}
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

export function Page({ title, actions, children, narrow }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cx('mx-auto px-6 py-6', narrow ? 'max-w-3xl' : 'max-w-6xl')}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
        {children}
      </div>
    </div>
  );
}
