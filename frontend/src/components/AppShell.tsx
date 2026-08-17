'use client';

import React, { useEffect, useRef, useState } from 'react';
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
import { WorkflowBuilder } from './WorkflowBuilder';
import { CurlModal } from './CurlModal';
import { ScratchpadWorkspace } from './ScratchpadWorkspace';
import { ToastHost } from './ToastHost';
import { AutomationsView } from './views/AutomationsView';
import { ManageView } from './views/ManageView';
import { AdminView } from './views/AdminView';
import { HistoryView } from './views/HistoryView';

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
  if (scratchpadOpen) {
    return <ScratchpadWorkspace onClose={onCloseScratchpad} />;
  }
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
  const prevRequestId = useRef<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (ws.activeRequestId && ws.activeRequestId !== prevRequestId.current)
      setScratchpadOpen(false);
    prevRequestId.current = ws.activeRequestId;
  }, [ws.activeRequestId]);

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
    <div className="app">
      <TopBar onOpenCurl={() => setCurlOpen(true)} onOpenScratchpad={() => setScratchpadOpen(true)} />
      <div className="app-body">
        <Sidebar panelHidden={view !== 'workspace'} />
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
      <CurlModal open={curlOpen} onClose={() => setCurlOpen(false)} />
      <ToastHost />
    </div>
  );
}
