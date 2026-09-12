'use client';

import React, { useState } from 'react';
import { mockServerApi } from '@/lib/api';
import { MockServerLink } from './MockServerLink';
import { type MockServerAdmin } from './useMockServerAdmin';
import styles from './mocks.module.css';

export function MockServerOverviewTab({
  admin,
  projectId,
}: {
  admin: MockServerAdmin;
  projectId: string;
}) {
  const [toggling, setToggling] = useState(false);
  const server = admin.server;

  const onToggle = async () => {
    if (!server) return;
    setToggling(true);
    try {
      await mockServerApi.update(server.id, { enabled: !server.enabled });
      await admin.load();
    } finally {
      setToggling(false);
    }
  };

  return (
    <section className={styles.section} data-testid="mock-overview-tab">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Shareable URL</h2>
        <span className={styles.sectionHint}>
          Send requests here and the mock server answers with the responses you defined.
        </span>
      </div>
      <div className={styles.inlineForm}>
        <MockServerLink projectId={projectId} />
        <span className={`${styles.badge} ${server?.enabled ? styles.badgeStatic : styles.badgeUnmatched}`}>
          {server?.enabled ? 'Enabled' : 'Disabled'}
        </span>
        <button
          className={styles.btn}
          type="button"
          onClick={onToggle}
          disabled={toggling || admin.busy}
          data-testid="mock-overview-toggle-enabled"
        >
          {server?.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>How it works</h2>
      </div>
      <ol className={styles.overviewSteps}>
        <li>Add an endpoint (method + path).</li>
        <li>Give it a response.</li>
        <li>Send a request to the URL above.</li>
        <li>Use a scenario to switch responses.</li>
      </ol>

      <div className={styles.statTiles}>
        <div className={styles.statTile} data-testid="mock-stat-endpoints">
          <span className={styles.statValue}>{admin.routes.length}</span>
          <span className={styles.statLabel}>Endpoints</span>
        </div>
        <div className={styles.statTile} data-testid="mock-stat-scenarios">
          <span className={styles.statValue}>{admin.scenarios.length}</span>
          <span className={styles.statLabel}>Scenarios</span>
        </div>
        <div className={styles.statTile} data-testid="mock-stat-calls">
          <span className={styles.statValue}>{admin.logs.length}</span>
          <span className={styles.statLabel}>Captured calls</span>
        </div>
      </div>

      <p className={styles.sectionHint}>
        Activate a scenario with the header <code>X-Mock-Scenario: &lt;name&gt;</code> or the query
        parameter <code>?__scenario=&lt;name&gt;</code>.
      </p>
    </section>
  );
}
