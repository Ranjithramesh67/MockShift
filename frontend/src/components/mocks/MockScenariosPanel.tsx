'use client';

import React, { useState } from 'react';
import styles from './mocks.module.css';
import { useMockServerAdmin } from './useMockServerAdmin';
import { MockServerOverviewTab } from './MockServerOverviewTab';
import { MockEndpointsTab } from './MockEndpointsTab';
import { MockScenariosTab } from './MockScenariosTab';
import { MockResponsesTab } from './MockResponsesTab';
import { MockCallLogTab } from './MockCallLogTab';

// ============================================================================
// Standalone mock-scenarios panel (E3).
//
// Coordinator seam: mount it for a project, e.g. from the app shell / a route:
//   import { MockScenariosPanel } from '@/components/mocks/MockScenariosPanel';
//   <MockScenariosPanel projectId={projectId} />
//
// The panel resolves the project's mock server itself, then manages named
// scenarios, conditional/sequence responses and the call log (with replay) in a
// guided, tabbed flow.
// ============================================================================

export interface MockScenariosPanelProps {
  projectId: string;
  // Optional override; a project has at most one mock server so this is only a
  // hint (the panel still resolves the server through the project).
  mockServerId?: string | null;
  className?: string;
}

type MockTab = 'overview' | 'endpoints' | 'scenarios' | 'responses' | 'call-log';

const TABS: Array<{ id: MockTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'responses', label: 'Responses' },
  { id: 'call-log', label: 'Call log' },
];

export function MockScenariosPanel({ projectId, className }: MockScenariosPanelProps) {
  const admin = useMockServerAdmin(projectId);
  const [tab, setTab] = useState<MockTab>('overview');

  if (!admin.server && !admin.loading) {
    return (
      <div className={[styles.panel, className].filter(Boolean).join(' ')} data-testid="mock-scenarios-panel">
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Mock server</h1>
            <p className={styles.subtitle}>Serve fake API responses for this project without a backend.</p>
          </div>
        </div>
        {admin.error ? <div className={styles.error}>{admin.error}</div> : null}
        {admin.notice ? <div className={styles.success}>{admin.notice}</div> : null}
        <div className={styles.section}>
          <p className={styles.empty}>This project has no mock server yet. Create one to get started.</p>
          <div className={styles.inlineForm}>
            <div className={`${styles.field} ${styles.fieldGrow}`}>
              <label className={styles.label} htmlFor="new-mock-server-name">Name</label>
              <input
                id="new-mock-server-name"
                className={styles.input}
                value={admin.newServerName}
                data-testid="mock-scenarios-server-name"
                onChange={(event) => admin.setNewServerName(event.target.value)}
              />
            </div>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              onClick={admin.createServer}
              disabled={admin.busy || !projectId}
              data-testid="mock-scenarios-create-server"
            >
              Create mock server
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={[styles.panel, className].filter(Boolean).join(' ')} data-testid="mock-scenarios-panel">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{admin.server?.name || 'Mock server'}</h1>
          <p className={styles.subtitle}>A guided place to define endpoints, responses and scenarios.</p>
        </div>
        <div className={styles.actions}>
          <button className={styles.btn} type="button" onClick={admin.load} disabled={admin.loading || admin.busy}>
            Refresh
          </button>
        </div>
      </div>

      {admin.error ? <div className={styles.error}>{admin.error}</div> : null}
      {admin.notice ? <div className={styles.success}>{admin.notice}</div> : null}

      <nav className={styles.tabs} role="tablist" data-testid="mock-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
            data-testid={`mock-tab-${item.id}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {admin.server ? (
        tab === 'overview' ? (
          <MockServerOverviewTab admin={admin} projectId={projectId} />
        ) : tab === 'endpoints' ? (
          <MockEndpointsTab
            admin={admin}
            onOpenResponses={(id) => {
              admin.handleRouteSelect(id);
              setTab('responses');
            }}
          />
        ) : tab === 'scenarios' ? (
          <MockScenariosTab
            admin={admin}
            onOpenResponses={(id) => {
              admin.handleRouteSelect(id);
              setTab('responses');
            }}
          />
        ) : tab === 'responses' ? (
          <MockResponsesTab admin={admin} />
        ) : (
          <MockCallLogTab admin={admin} />
        )
      ) : null}
    </div>
  );
}
