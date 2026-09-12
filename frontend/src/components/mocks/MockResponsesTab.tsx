'use client';

import React from 'react';
import {
  MOCK_CONDITION_OPERATORS,
  MOCK_CONDITION_SOURCES,
  operatorNeedsValue,
  type MockConditionOperator,
  type MockConditionSource,
  type MockSequenceMode,
} from '@/lib/mockScenariosApi';
import { type MockServerAdmin } from './useMockServerAdmin';
import styles from './mocks.module.css';

export function MockResponsesTab({ admin }: { admin: MockServerAdmin }) {
  const {
    routes,
    scenarios,
    responses,
    selectedRouteId,
    showForm,
    setShowForm,
    draft,
    setDraft,
    busy,
  } = admin;

  return (
    <section className={styles.section} data-testid="mock-responses-tab">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Responses for</h2>
        <div className={styles.actions}>
          <select
            className={styles.select}
            value={selectedRouteId}
            aria-label="Endpoint"
            data-testid="mock-responses-route-select"
            onChange={(event) => admin.handleRouteSelect(event.target.value)}
          >
            {routes.length === 0 ? <option value="">No endpoints</option> : null}
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.method} {route.path}
              </option>
            ))}
          </select>
          <button
            className={styles.btn}
            type="button"
            onClick={() => setShowForm((value) => !value)}
            disabled={!selectedRouteId}
            data-testid="mock-responses-add"
          >
            {showForm ? 'Cancel' : 'Add response'}
          </button>
          <button
            className={styles.btn}
            type="button"
            onClick={admin.resetSequence}
            disabled={!selectedRouteId || busy}
          >
            Reset sequence
          </button>
        </div>
      </div>

      <p className={styles.sectionHint}>
        Default responses answer every call. Conditional responses answer only when their conditions
        match. Sequences rotate through responses in order.
      </p>

      {showForm ? (
        <div className={styles.responseForm} data-testid="mock-response-form">
          <div className={styles.subForm}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>When should this response be used?</span>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Scenario</label>
                <select
                  className={styles.select}
                  value={draft.scenarioId}
                  onChange={(event) => setDraft({ ...draft, scenarioId: event.target.value })}
                >
                  <option value="">Default (no scenario)</option>
                  {scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
                <span className={styles.fieldHint}>
                  Default is served for every call. A named scenario response is served only while
                  that scenario is active.
                </span>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Priority</label>
                <input
                  className={styles.input}
                  value={draft.priority}
                  inputMode="numeric"
                  onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
                />
              </div>
            </div>

            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>Conditions (all must match)</span>
              <button className={styles.btn} type="button" onClick={admin.addCondition}>
                Add condition
              </button>
            </div>
            {draft.conditions.length === 0 ? (
              <p className={styles.empty}>
                No conditions: this response is always eligible for the selected scope.
              </p>
            ) : (
              <div className={styles.conditions}>
                {draft.conditions.map((condition, index) => (
                  <div key={index} className={styles.conditionRow}>
                    <select
                      className={styles.select}
                      value={condition.source}
                      onChange={(event) =>
                        admin.updateCondition(index, {
                          source: event.target.value as MockConditionSource,
                        })
                      }
                    >
                      {MOCK_CONDITION_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                    <input
                      className={styles.input}
                      placeholder="name (e.g. x-api-key or user.role)"
                      value={condition.name}
                      onChange={(event) =>
                        admin.updateCondition(index, { name: event.target.value })
                      }
                    />
                    <select
                      className={styles.select}
                      value={condition.operator}
                      onChange={(event) =>
                        admin.updateCondition(index, {
                          operator: event.target.value as MockConditionOperator,
                        })
                      }
                    >
                      {MOCK_CONDITION_OPERATORS.map((operator) => (
                        <option key={operator} value={operator}>
                          {operator}
                        </option>
                      ))}
                    </select>
                    {operatorNeedsValue(condition.operator) ? (
                      <input
                        className={styles.input}
                        placeholder={condition.operator === 'in' ? 'a,b,c' : 'value'}
                        value={String(condition.value ?? '')}
                        onChange={(event) =>
                          admin.updateCondition(index, { value: event.target.value })
                        }
                      />
                    ) : null}
                    <button
                      className={`${styles.btn} ${styles.btnDanger}`}
                      type="button"
                      onClick={() => admin.removeCondition(index)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.subForm}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>What should it return?</span>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Status</label>
                <input
                  className={styles.input}
                  value={draft.status}
                  inputMode="numeric"
                  onChange={(event) => setDraft({ ...draft, status: event.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Delay (ms)</label>
                <input
                  className={styles.input}
                  value={draft.delayMs}
                  inputMode="numeric"
                  onChange={(event) => setDraft({ ...draft, delayMs: event.target.value })}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={`${styles.field} ${styles.fieldGrow}`}>
                <label className={styles.label}>Response body</label>
                <textarea
                  className={styles.textarea}
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                />
              </div>
              <div className={`${styles.field} ${styles.fieldGrow}`}>
                <label className={styles.label}>Headers (JSON)</label>
                <textarea
                  className={styles.textarea}
                  value={draft.headers}
                  placeholder='{"x-mock":"true"}'
                  onChange={(event) => setDraft({ ...draft, headers: event.target.value })}
                />
              </div>
            </div>
          </div>

          <div className={styles.subForm}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>Advanced: sequence</span>
            </div>
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label}>Sequence index</label>
                <input
                  className={styles.input}
                  value={draft.sequenceIndex}
                  placeholder="blank = conditional"
                  inputMode="numeric"
                  onChange={(event) => setDraft({ ...draft, sequenceIndex: event.target.value })}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Sequence mode</label>
                <select
                  className={styles.select}
                  value={draft.sequenceMode}
                  onChange={(event) =>
                    setDraft({ ...draft, sequenceMode: event.target.value as MockSequenceMode })
                  }
                >
                  <option value="cycle">cycle</option>
                  <option value="advance">advance</option>
                </select>
              </div>
            </div>
          </div>

          <div className={styles.inlineForm}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              type="button"
              onClick={admin.submitResponse}
              disabled={busy}
            >
              Save response
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.responseList}>
        {responses.length === 0 ? (
          <p className={styles.empty}>No conditional or sequence responses for this endpoint.</p>
        ) : (
          <div className={styles.list}>
            {responses.map((response) => (
              <div key={response.id} className={styles.listItem}>
                <div className={styles.itemMain}>
                  <span className={styles.itemName}>
                    {response.name ||
                      (response.sequence_index === null
                        ? 'Conditional response'
                        : `Sequence #${response.sequence_index}`)}
                  </span>
                  <span className={styles.itemMeta}>
                    <span className={styles.badgeStatus}>status {response.status}</span>
                    <span className={styles.badge}>{admin.scenarioName(response.scenario_id)}</span>
                    <span className={styles.badge}>priority {response.priority}</span>
                    {response.sequence_index !== null ? (
                      <span className={styles.badge}>
                        sequence {response.sequence_index} · {response.sequence_mode}
                      </span>
                    ) : null}
                    {response.conditions.length > 0 ? (
                      <span className={styles.badge}>
                        {response.conditions.length} condition
                        {response.conditions.length === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className={styles.itemActions}>
                  <button
                    className={`${styles.btn} ${styles.btnDanger}`}
                    type="button"
                    onClick={() => admin.deleteResponse(response.id)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
