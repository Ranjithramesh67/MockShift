'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useApp } from '@/store/AppStore';
import { useNav } from '@/store/NavStore';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { SplitPane } from './SplitPane';
import { RequestConfigurator } from './RequestConfigurator';
import { RequestTabs } from './RequestTabs';
import { ResponsePane } from './ResponsePane';
import { WorkflowBuilder } from './WorkflowBuilder';
import { CurlModal } from './CurlModal';
import { ScratchpadModal } from './ScratchpadModal';
import { ToastHost } from './ToastHost';
import { AutomationsView } from './views/AutomationsView';
import { ManageView } from './views/ManageView';
import { AdminView } from './views/AdminView';
import { HistoryView } from './views/HistoryView';

function WorkspaceArea({ onOpenCurl }: { onOpenCurl: () => void }) {
  const { state, dispatch } = useApp();
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
  const router = useRouter();
  const [curlOpen, setCurlOpen] = useState(false);
  const [scratchpadOpen, setScratchpadOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

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
            <WorkspaceArea onOpenCurl={() => setCurlOpen(true)} />
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
      <ScratchpadModal open={scratchpadOpen} onClose={() => setScratchpadOpen(false)} />
      <ToastHost />
    </div>
  );
}
