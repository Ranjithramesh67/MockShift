'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useApp } from '@/store/AppStore';
import { useNav } from '@/store/NavStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { SplitPane } from './SplitPane';
import { RequestConfigurator } from './RequestConfigurator';
import { RequestTabs } from './RequestTabs';
import { ResponsePane } from './ResponsePane';
import { ProjectOverview } from './ProjectOverview';
import { ToastHost } from './ToastHost';
import { useCloseRequestTabShortcut } from './useCloseRequestTabShortcut';

const WorkflowBuilder = dynamic(() => import('./WorkflowBuilder').then((m) => m.WorkflowBuilder));
const CurlModal = dynamic(() => import('./CurlModal').then((m) => m.CurlModal));
const ScratchpadWorkspace = dynamic(() => import('./ScratchpadWorkspace').then((m) => m.ScratchpadWorkspace));
const AutomationsView = dynamic(() => import('./views/AutomationsView').then((m) => m.AutomationsView));
const ManageView = dynamic(() => import('./views/ManageView').then((m) => m.ManageView));
const AdminView = dynamic(() => import('./views/AdminView').then((m) => m.AdminView));
const HistoryView = dynamic(() => import('./views/HistoryView').then((m) => m.HistoryView));

function WorkspaceArea({
  onOpenCurl,
  scratchpadOpen,
  onCloseScratchpad,
}: {
  onOpenCurl: () => void;
  scratchpadOpen: boolean;
  onCloseScratchpad: () => void;
}) {
  const { state, dispatch } = useApp();
  const ws = useWorkspace();
  if (scratchpadOpen) {
    return <ScratchpadWorkspace onClose={onCloseScratchpad} />;
  }
  // The project overview replaces the request editor whenever it is open (or
  // still loading) and no request tab is being edited. Requests opened from the
  // tree / tab strip take priority and close the overview.
  const projectOverviewActive =
    (ws.overview !== null || ws.overviewLoading || ws.overviewError !== null) &&
    ws.activeRequestId === null &&
    ws.openRequestIds.length === 0;
  return (
    <>
      <TabBar
        tabs={[
          { id: 'request', label: 'Request' },
          { id: 'workflow', label: 'Workflow' },
        ]}
        active={state.activeTab}
        onChange={(tab) => dispatch({ type: 'SET_TAB', tab })}
        testIdPrefix="main"
      />
      {state.activeTab === 'request' ? (
        projectOverviewActive ? (
          <ProjectOverview />
        ) : (
          <>
            <RequestTabs />
            {state.viewMode === 'request' ? (
              <RequestConfigurator onOpenCurl={onOpenCurl} />
            ) : state.viewMode === 'response' ? (
              <ResponsePane />
            ) : state.viewMode === 'side' ? (
              <SplitPane
                orientation="horizontal"
                top={<RequestConfigurator onOpenCurl={onOpenCurl} />}
                bottom={<ResponsePane />}
              />
            ) : (
              <SplitPane
                orientation="vertical"
                top={<RequestConfigurator onOpenCurl={onOpenCurl} />}
                bottom={<ResponsePane />}
              />
            )}
          </>
        )
      ) : (
        <div className="workflow-area">
          <WorkflowBuilder />
        </div>
      )}
    </>
  );
}

export function AppShell() {
  const { loading, user } = useAuth();
  const { view } = useNav();
  const ws = useWorkspace();
  const router = useRouter();
  const [curlOpen, setCurlOpen] = useState(false);
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const prevRequestId = useRef<string | null>(null);

  useCloseRequestTabShortcut();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (ws.activeRequestId && ws.activeRequestId !== prevRequestId.current)
      setScratchpadOpen(false);
    prevRequestId.current = ws.activeRequestId;
  }, [ws.activeRequestId]);

  // Close the mobile drawer when the user presses Escape.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // Lock page scroll while the mobile drawer is open (CSS scoped to <=900px).
  useEffect(() => {
    document.body.classList.toggle('sidebar-drawer-open', navOpen);
    return () => document.body.classList.remove('sidebar-drawer-open');
  }, [navOpen]);

  if (loading) {
    return (
      <div className="loading-screen" data-testid="loading-splash">
        <span className="spinner" />
        Loading workspace…
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className={`app${navOpen ? ' sidebar-drawer-open' : ''}`}>
      <TopBar
        onOpenCurl={() => setCurlOpen(true)}
        onOpenScratchpad={() => setScratchpadOpen(true)}
        drawerOpen={navOpen}
        onToggleDrawer={() => setNavOpen((v) => !v)}
      />
      <div className="app-body">
        <Sidebar panelHidden={view !== 'workspace'} onRequestClose={() => setNavOpen(false)} />
        <main className="main-area">
          {view === 'workspace' ? (
            <WorkspaceArea
              onOpenCurl={() => setCurlOpen(true)}
              scratchpadOpen={scratchpadOpen}
              onCloseScratchpad={() => setScratchpadOpen(false)}
            />
          ) : (
            <div className="admin-view">
              {view === 'automations' ? (
                <AutomationsView />
              ) : view === 'manage' ? (
                <ManageView />
              ) : view === 'history' ? (
                <HistoryView />
              ) : (
                <AdminView />
              )}
            </div>
          )}
        </main>
      </div>
      {navOpen && (
        <div
          className="sidebar-backdrop"
          data-testid="sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      )}
      <CurlModal open={curlOpen} onClose={() => setCurlOpen(false)} />
      <ToastHost />
    </div>
  );
}
