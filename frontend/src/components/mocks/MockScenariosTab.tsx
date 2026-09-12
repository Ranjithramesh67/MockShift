'use client';

import React from 'react';
import { useApp } from '@/store/AppStore';
import { copyText } from '@/lib/clipboard';
import {
  groupLinksByRoute,
  type MockServerAdmin,
  type ScenarioRouteGroup,
} from './useMockServerAdmin';
import styles from './mocks.module.css';

function ScenarioRouteGroupView({
  group,
  onOpenResponses,
}: {
  group: ScenarioRouteGroup;
  onOpenResponses: (routeId: string) => void;
}) {
  return (
    <div className={styles.scenarioRoute}>
      <button
        className={styles.scenarioRouteHead}
        type="button"
        onClick={() => onOpenResponses(group.routeId)}
        title="Open this endpoint's responses"
      >
        <span className={styles.logMethod}>{group.method}</span>
        <code className={styles.scenarioRoutePath}>{group.path}</code>
      </button>
      <div className={styles.scenarioRouteResponses}>
        {group.responses.map((link) => (
          <div key={link.response_id} className={styles.scenarioResponse}>
            <span className={styles.badge}>{link.name || 'Response'}</span>
            <span className={styles.badgeStatus}>status {link.status}</span>
            {link.conditions.length > 0 ? (
              <span className={styles.badge}>
                {link.conditions.length} condition
                {link.conditions.length === 1 ? '' : 's'}
              </span>
            ) : null}
            {link.sequence_index !== null ? (
              <span className={styles.badge}>
                seq {link.sequence_index} · {link.sequence_mode}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MockScenariosTab({
  admin,
  onOpenResponses,
}: {
  admin: MockServerAdmin;
  onOpenResponses: (routeId: string) => void;
}) {
  const { dispatch } = useApp();
  const {
    scenarios,
    linksByScenario,
    busy,
    newScenarioName,
    setNewScenarioName,
    expandedScenarioId,
    setExpandedScenarioId,
    showDefaultOverrides,
    setShowDefaultOverrides,
  } = admin;

  const onCopyActivation = async () => {
    const ok = await copyText('X-Mock-Scenario: maintenance');
    dispatch({
      type: 'SHOW_TOAST',
      kind: ok ? 'success' : 'error',
      message: ok ? 'Header copied.' : 'Could not copy the header.',
    });
  };

  return (
    <section className={styles.section} data-testid="mock-scenarios-tab">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Scenarios (response presets)</h2>
        <span className={styles.sectionHint}>
          A scenario is a named set of responses. Activate one per request to switch what the mock
          returns without editing your request.
        </span>
      </div>

      <div className={styles.inlineForm} data-testid="mock-scenario-activation-hint">
        <span className={styles.sectionHint}>Activate with</span>
        <code>X-Mock-Scenario: maintenance</code>
        <button
          className={styles.btn}
          type="button"
          onClick={onCopyActivation}
          data-testid="mock-scenario-copy-header"
        >
          Copy header
        </button>
        <span className={styles.sectionHint}>
          or <code>?__scenario=maintenance</code> in the URL.
        </span>
      </div>

      {scenarios.length === 0 ? (
        <p className={styles.empty}>
          No scenarios yet. Create one below, then override an endpoint&apos;s response inside it.
        </p>
      ) : (
        <div className={styles.list}>
          {scenarios.map((scenario) => {
            const links = linksByScenario.map.get(scenario.id) || [];
            const groups = groupLinksByRoute(links);
            const expanded = expandedScenarioId === scenario.id;
            return (
              <div key={scenario.id} className={styles.scenarioRow}>
                <div className={styles.listItem}>
                  <button
                    className={styles.scenarioToggle}
                    type="button"
                    onClick={() => setExpandedScenarioId(expanded ? null : scenario.id)}
                    aria-expanded={expanded}
                    data-testid={`mock-scenario-toggle-${scenario.id}`}
                  >
                    <span className={styles.chevron}>{expanded ? '\u25be' : '\u25b8'}</span>
                    <span className={styles.itemMain}>
                      <span className={styles.itemName}>{scenario.name}</span>
                      {scenario.description ? (
                        <span className={styles.subtitle}>{scenario.description}</span>
                      ) : null}
                    </span>
                    <span className={styles.badge}>
                      {groups.length === 0
                        ? 'no overrides'
                        : `${groups.length} route${groups.length === 1 ? '' : 's'} · ${links.length} response${links.length === 1 ? '' : 's'}`}
                    </span>
                  </button>
                  <div className={styles.itemActions}>
                    <button
                      className={`${styles.btn} ${styles.btnDanger}`}
                      type="button"
                      onClick={() => admin.deleteScenario(scenario.id)}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {expanded ? (
                  <div className={styles.scenarioRoutes}>
                    {groups.length === 0 ? (
                      <p className={styles.empty}>
                        No endpoints use this scenario yet. Open an endpoint in the Responses tab and
                        select this scenario.
                      </p>
                    ) : (
                      groups.map((group) => (
                        <ScenarioRouteGroupView
                          key={group.routeId}
                          group={group}
                          onOpenResponses={onOpenResponses}
                        />
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.inlineForm}>
        <div className={`${styles.field} ${styles.fieldGrow}`}>
          <label className={styles.label} htmlFor="new-scenario-name">
            New scenario
          </label>
          <input
            id="new-scenario-name"
            className={styles.input}
            value={newScenarioName}
            placeholder="e.g. maintenance"
            data-testid="mock-scenarios-new-scenario-name"
            onChange={(event) => setNewScenarioName(event.target.value)}
          />
        </div>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          type="button"
          onClick={admin.createScenario}
          disabled={busy || !newScenarioName.trim()}
          data-testid="mock-scenarios-create-scenario"
        >
          Add scenario
        </button>
      </div>

      {linksByScenario.defaults.length > 0 ? (
        <div className={styles.scenarioRow}>
          <div className={styles.listItem}>
            <button
              className={styles.scenarioToggle}
              type="button"
              onClick={() => setShowDefaultOverrides((current) => !current)}
              aria-expanded={showDefaultOverrides}
            >
              <span className={styles.chevron}>{showDefaultOverrides ? '\u25be' : '\u25b8'}</span>
              <span className={styles.itemMain}>
                <span className={styles.itemName}>Default responses</span>
                <span className={styles.subtitle}>
                  Applied when no scenario overrides the endpoint.
                </span>
              </span>
              <span className={styles.badge}>
                {groupLinksByRoute(linksByScenario.defaults).length} route
                {groupLinksByRoute(linksByScenario.defaults).length === 1 ? '' : 's'}
              </span>
            </button>
          </div>
          {showDefaultOverrides ? (
            <div className={styles.scenarioRoutes}>
              {groupLinksByRoute(linksByScenario.defaults).map((group) => (
                <ScenarioRouteGroupView
                  key={group.routeId}
                  group={group}
                  onOpenResponses={onOpenResponses}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
