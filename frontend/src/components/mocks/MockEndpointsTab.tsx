'use client';

import React from 'react';
import { type MockServerAdmin } from './useMockServerAdmin';
import styles from './mocks.module.css';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'];

export function MockEndpointsTab({
  admin,
  onOpenResponses,
}: {
  admin: MockServerAdmin;
  onOpenResponses: (routeId: string) => void;
}) {
  const { routes, busy, routeDraft, setRouteDraft, showRouteForm, editingRouteId } = admin;

  return (
    <section className={styles.section} data-testid="mock-endpoints-tab">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Endpoints</h2>
        <div className={styles.actions}>
          <span className={styles.sectionHint}>An endpoint is a method + path the mock server answers.</span>
          <span className={styles.sectionHint}>
            {routes.length} endpoint{routes.length === 1 ? '' : 's'}
          </span>
          <button
            className={styles.btn}
            type="button"
            onClick={admin.startAddRoute}
            disabled={busy}
            data-testid="mock-scenarios-add-route"
          >
            {showRouteForm && !editingRouteId ? 'Cancel' : 'Add endpoint'}
          </button>
        </div>
      </div>

      {routes.length === 0 ? (
        <p className={styles.empty}>No endpoints yet. Add the first one below.</p>
      ) : (
        <div className={styles.list}>
          {routes.map((route) => (
            <div key={route.id} className={styles.listItem}>
              <div className={styles.itemMain}>
                <span className={styles.itemName}>
                  <span className={styles.logMethod}>{route.method}</span> {route.path}
                </span>
                <span className={styles.itemMeta}>
                  <span className={styles.badgeStatus}>status {route.status}</span>
                  {route.delay_ms ? (
                    <span className={styles.badge}>delay {route.delay_ms}ms</span>
                  ) : null}
                </span>
              </div>
              <div className={styles.itemActions}>
                <button
                  className={styles.btn}
                  type="button"
                  onClick={() => onOpenResponses(route.id)}
                  disabled={busy}
                >
                  Responses
                </button>
                <button
                  className={styles.btn}
                  type="button"
                  onClick={() => admin.startEditRoute(route)}
                  disabled={busy}
                >
                  Edit
                </button>
                <button
                  className={`${styles.btn} ${styles.btnDanger}`}
                  type="button"
                  onClick={() => admin.deleteRoute(route)}
                  disabled={busy}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showRouteForm ? (
        <div className={styles.routeForm}>
          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label}>Method</label>
              <select
                className={styles.select}
                value={routeDraft.method}
                data-testid="mock-scenarios-route-method"
                onChange={(event) =>
                  setRouteDraft({ ...routeDraft, method: event.target.value })
                }
              >
                {METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.field} ${styles.fieldGrow}`}>
              <label className={styles.label}>Path</label>
              <input
                className={styles.input}
                placeholder="/users/:id"
                value={routeDraft.path}
                data-testid="mock-scenarios-route-path"
                onChange={(event) =>
                  setRouteDraft({ ...routeDraft, path: event.target.value })
                }
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Status</label>
              <input
                className={styles.input}
                value={routeDraft.status}
                inputMode="numeric"
                data-testid="mock-scenarios-route-status"
                onChange={(event) =>
                  setRouteDraft({ ...routeDraft, status: event.target.value })
                }
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Delay (ms)</label>
              <input
                className={styles.input}
                value={routeDraft.delayMs}
                inputMode="numeric"
                data-testid="mock-scenarios-route-delay"
                onChange={(event) =>
                  setRouteDraft({ ...routeDraft, delayMs: event.target.value })
                }
              />
            </div>
          </div>
          <div className={styles.row}>
            <div className={`${styles.field} ${styles.fieldGrow}`}>
              <label className={styles.label}>Response body</label>
              <textarea
                className={styles.textarea}
                value={routeDraft.body}
                placeholder='{"userId":"{{id}}"}'
                data-testid="mock-scenarios-route-body"
                onChange={(event) =>
                  setRouteDraft({ ...routeDraft, body: event.target.value })
                }
              />
            </div>
            <div className={`${styles.field} ${styles.fieldGrow}`}>
              <label className={styles.label}>Headers (JSON)</label>
              <textarea
                className={styles.textarea}
                value={routeDraft.headers}
                placeholder='{"x-mock":"true"}'
                data-testid="mock-scenarios-route-headers"
                onChange={(event) =>
                  setRouteDraft({ ...routeDraft, headers: event.target.value })
                }
              />
            </div>
          </div>
          <div className={styles.inlineForm}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              onClick={admin.submitRoute}
              disabled={busy || !routeDraft.path.trim()}
              data-testid="mock-scenarios-save-route"
            >
              {editingRouteId ? 'Save endpoint' : 'Add endpoint'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
