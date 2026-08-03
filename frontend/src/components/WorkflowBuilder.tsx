'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { LoopConfig, Workflow, WorkflowStep } from '@/lib/types';
import { useApp } from '@/store/AppStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import { validateWorkflow } from '@/lib/workflowValidation';
import { makeId } from '@/lib/defaultState';
import { CodeEditor } from './CodeEditor';

const LOOP_TYPE_LABELS: Array<{ id: LoopConfig['type']; label: string }> = [
  { id: 'none', label: 'No loop' },
  { id: 'count', label: 'Fixed count' },
  { id: 'until', label: 'Until condition' },
];

function emptyStep(index: number): WorkflowStep {
  return {
    id: makeId('step'),
    label: `Step ${index + 1}`,
    requestId: null,
    delayMs: 0,
    loop: { type: 'none' },
    onFailure: 'abort',
    formula: '',
  };
}

export function WorkflowBuilder() {
  const { state, dispatch } = useApp();
  const workflow = state.workflows.find((w) => w.id === state.activeWorkflowId);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [errors, setErrors] = useState<Array<{ stepId: string | null; message: string }>>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!workflow) return;
    setDraft(JSON.parse(JSON.stringify(workflow)));
    setErrors([]);
  }, [workflow]);

  const steps = useMemo(() => draft?.steps ?? [], [draft]);
  const requestOptions = state.requests;

  if (!draft) {
    return (
      <div className="panel-empty">
        No workflow selected. Add a workflow to start chaining requests.
      </div>
    );
  }

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    setDraft({
      ...draft,
      steps: steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    });
    setErrors([]);
  };

  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraft({ ...draft, steps: next });
    setErrors([]);
  };

  const addStep = () => {
    setDraft({ ...draft, steps: [...steps, emptyStep(steps.length)] });
    setErrors([]);
  };

  const removeStep = (index: number) => {
    setDraft({ ...draft, steps: steps.filter((_, i) => i !== index) });
    setErrors([]);
  };

  const updateLoop = (index: number, loop: LoopConfig) => {
    updateStep(index, { loop });
  };

  const onSave = () => {
    const result = validateWorkflow(draft);
    setErrors(result.errors);
    if (!result.valid) {
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'error',
        message: 'Workflow not saved. Fix the validation errors below.',
      });
      return;
    }
    dispatch({ type: 'SAVE_WORKFLOW', workflow: draft });
    dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Workflow saved.' });
  };

  return (
    <div className="workflow-builder" data-testid="workflow-builder">
      <div className="workflow-toolbar">
        <input
          className="text-input"
          type="text"
          value={draft.name}
          aria-label="Workflow name"
          data-testid="workflow-name-input"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <button type="button" className="primary-button" data-testid="workflow-save-button" onClick={onSave}>
          Save workflow
        </button>
        <button type="button" className="ghost-button" data-testid="add-step-button" onClick={addStep}>
          + Add step
        </button>
      </div>

      {errors.length > 0 && (
        <div className="validation-banner" data-testid="workflow-errors" role="alert">
          <strong>Workflow cannot be saved:</strong>
          <ul>
            {errors.map((err, i) => (
              <li key={i}>{err.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="step-list" data-testid="step-list">
        {steps.length === 0 && <div className="panel-empty">No steps yet. Add a step to chain requests.</div>}
        {steps.map((step, index) => (
          <div
            key={step.id}
            className="step-card"
            data-testid={`step-card-${index}`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIndex === null || dragIndex === index) return;
              moveStep(dragIndex, index);
              setDragIndex(index);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <div className="step-card-header">
              <span className="drag-handle" title="Drag to reorder">
                ::
              </span>
              <span className="step-number">#{index + 1}</span>
              <input
                className="text-input"
                type="text"
                value={step.label}
                aria-label={`Step ${index + 1} label`}
                data-testid={`step-label-input-${index}`}
                onChange={(e) => updateStep(index, { label: e.target.value })}
              />
              <div className="step-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Move step up"
                  disabled={index === 0}
                  onClick={() => moveStep(index, index - 1)}
                >
                  up
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Move step down"
                  disabled={index === steps.length - 1}
                  onClick={() => moveStep(index, index + 1)}
                >
                  down
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove step"
                  data-testid={`remove-step-button-${index}`}
                  onClick={() => removeStep(index)}
                >
                  x
                </button>
              </div>
            </div>

            <div className="step-grid">
              <label className="field">
                <span className="field-label">Request</span>
                <select
                  className="compact-select"
                  value={step.requestId ?? ''}
                  aria-label="Request"
                  data-testid={`step-request-select-${index}`}
                  onChange={(e) => updateStep(index, { requestId: e.target.value || null })}
                >
                  <option value="">Select a request...</option>
                  {requestOptions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.method} {r.url})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">Delay (ms)</span>
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  value={Number.isFinite(step.delayMs) ? step.delayMs : 0}
                  aria-label="Delay milliseconds"
                  data-testid={`step-delay-input-${index}`}
                  onChange={(e) => updateStep(index, { delayMs: Number(e.target.value) || 0 })}
                />
              </label>

              <label className="field">
                <span className="field-label">Loop</span>
                <select
                  className="compact-select"
                  value={step.loop.type}
                  aria-label="Loop type"
                  data-testid={`step-loop-type-${index}`}
                  onChange={(e) => {
                    const type = e.target.value as LoopConfig['type'];
                    if (type === 'count') updateLoop(index, { type: 'count', count: 1 });
                    else if (type === 'until') updateLoop(index, { type: 'until', condition: '' });
                    else updateLoop(index, { type: 'none' });
                  }}
                >
                  {LOOP_TYPE_LABELS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              {step.loop.type === 'count' && (
                <label className="field">
                  <span className="field-label">Iterations</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1}
                    value={step.loop.count}
                    aria-label="Loop iterations"
                    data-testid={`step-loop-count-${index}`}
                    onChange={(e) => updateLoop(index, { type: 'count', count: Number(e.target.value) })}
                  />
                </label>
              )}

              <label className="field">
                <span className="field-label">On failure</span>
                <select
                  className="compact-select"
                  value={step.onFailure}
                  aria-label="On failure"
                  data-testid={`step-onfailure-${index}`}
                  onChange={(e) => updateStep(index, { onFailure: e.target.value as WorkflowStep['onFailure'] })}
                >
                  <option value="abort">Abort workflow</option>
                  <option value="skip">Skip to next step</option>
                </select>
              </label>
            </div>

            {step.loop.type === 'until' && (
              <div className="step-condition">
                <span className="field-label">Loop while (sandbox formula, $steps.stepLabel.status / .response)</span>
                <CodeEditor
                  value={step.loop.condition}
                  onChange={(condition) => updateLoop(index, { type: 'until', condition })}
                  language="javascript"
                  height="70px"
                  ariaLabel={`Loop condition for step ${index + 1}`}
                />
              </div>
            )}

            <div className="step-condition">
              <span className="field-label">Pre-step formula (optional)</span>
              <CodeEditor
                value={step.formula}
                onChange={(formula) => updateStep(index, { formula })}
                language="javascript"
                height="60px"
                ariaLabel={`Pre-step formula for step ${index + 1}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
