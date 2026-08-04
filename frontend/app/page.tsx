'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AppProvider, useApp } from '@/store/AppStore';
import { WorkspaceProvider } from '@/store/WorkspaceStore';
import { TopBar } from '@/components/TopBar';
import { Sidebar } from '@/components/Sidebar';
import { TabBar } from '@/components/TabBar';
import { SplitPane } from '@/components/SplitPane';
import { RequestConfigurator } from '@/components/RequestConfigurator';
import { ResponsePane } from '@/components/ResponsePane';
import { WorkflowBuilder } from '@/components/WorkflowBuilder';
import { CurlModal } from '@/components/CurlModal';
import { ToastHost } from '@/components/ToastHost';

function Workspace() {
  const { state, dispatch } = useApp();
  const [curlOpen, setCurlOpen] = useState(false);

  return (
    <div className="app">
      <TopBar onOpenCurl={() => setCurlOpen(true)} />
      <div className="app-body">
        <Sidebar />
        <main className="main-area">
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
            state.viewMode === 'request' ? (
              <RequestConfigurator onOpenCurl={() => setCurlOpen(true)} />
            ) : state.viewMode === 'response' ? (
              <ResponsePane />
            ) : state.viewMode === 'side' ? (
              <SplitPane
                orientation="horizontal"
                top={<RequestConfigurator onOpenCurl={() => setCurlOpen(true)} />}
                bottom={<ResponsePane />}
              />
            ) : (
              <SplitPane
                orientation="vertical"
                top={<RequestConfigurator onOpenCurl={() => setCurlOpen(true)} />}
                bottom={<ResponsePane />}
              />
            )
          ) : (
            <div className="workflow-area">
              <WorkflowBuilder />
            </div>
          )}
        </main>
      </div>
      <CurlModal open={curlOpen} onClose={() => setCurlOpen(false)} />
      <ToastHost />
    </div>
  );
}

function GuardedWorkspace() {
  const { loading, user } = useAuth();
  const router = useRouter();

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

  return <Workspace />;
}

export default function HomePage() {
  return (
    <AppProvider>
      <WorkspaceProvider>
        <GuardedWorkspace />
      </WorkspaceProvider>
    </AppProvider>
  );
}
