import { createBrowserRouter, useRouteError } from 'react-router';
import { Layout } from './Layout.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { PlotPage } from './pages/PlotPage.tsx';
import { PlotEditorPage } from './pages/PlotEditorPage.tsx';
import { ChatPage } from './pages/ChatPage.tsx';
import { LorebooksPage } from './pages/LorebooksPage.tsx';
import { ManagePage } from './pages/ManagePage.tsx';
import { PromptsPage } from './pages/PromptsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { OpenPage } from './pages/OpenPage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { WizardPage } from './pages/WizardPage.tsx';

// 画面の途中で例外が出ても真っ白にしない
function ErrorPage() {
  const error = useRouteError() as Error | undefined;
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-lg space-y-3 rounded-lg border border-line bg-panel p-6">
        <h1 className="text-lg font-semibold">画面でエラーが起きました</h1>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded border border-line bg-field p-3 text-xs text-danger">{error?.stack ?? error?.message ?? String(error)}</pre>
        <div className="flex gap-2">
          <button type="button" className="rounded-md bg-gold px-3 py-1.5 text-sm text-on-gold" onClick={() => location.reload()}>
            読み込み直す
          </button>
          <a href="/" className="rounded-md border border-line px-3 py-1.5 text-sm">
            ホームへ
          </a>
        </div>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'plots/:id', element: <PlotPage /> },
      { path: 'plots/:id/edit', element: <PlotEditorPage /> },
      { path: 'plots/:id/wizard', element: <WizardPage /> },
      { path: 'chats/:id', element: <ChatPage /> },
      { path: 'manage', element: <ManagePage /> },
      { path: 'lorebooks', element: <LorebooksPage /> },
      { path: 'prompts', element: <PromptsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'setup', element: <SetupPage /> },
      { path: 'open', element: <OpenPage /> },
    ],
  },
]);
