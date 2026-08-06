'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { LoopConfig, StepPassInput, Workflow, WorkflowStep } from '@/lib/types';
import { useApp } from '@/store/AppStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import { validateWorkflow, sanitizeLabel } from '@/lib/workflowValidation';
import { makeId } from '@/lib/defaultState';
import { CodeEditor } from './CodeEditor';
import { SaveIcon, PlusIcon, ArrowUpIcon, ArrowDownIcon, XIcon, GripIcon, WorkflowIcon } from './icons';

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

function defaultPassForm(priorSteps: WorkflowStep[]): StepPassInput {
  return {
    sourceStepId: priorSteps[priorSteps.length - 1]?.id ?? '',
    data: 'response',
    field: '',
    target: 'header',
    targetKey: '',
  };
}

const PASS_TARGET_LABELS: Array<{ id: StepPassInput['target']; label: string }> = [
  { id: 'header', label: 'Header' },
  { id: 'query', label: 'Query param' },
  { id: 'url', label: 'URL param' },
  { id: 'body', label: 'Body' },
];

const PASS_DATA_LABELS: Array<{ id: StepPassInput['data']; label: string }> = [
  { id: 'response', label: 'Response' },
  { id: 'request', label: 'Request' },
];

function PassInputSection({
  step,
  priorSteps,
  stepIndex,
  onChange,
}: {
  step: WorkflowStep;
  priorSteps: WorkflowStep[];
  stepIndex: number;
  onChange: (passInputs: StepPassInput[]) => void;
}) {
  const passInputs = step.passInputs ?? [];
  const [form, setForm] = useState<StepPassInput>(() => defaultPassForm(priorSteps));

  useEffect(() => {
    setForm((f) =>
      priorSteps.some((p) => p.id === f.sourceStepId) ? f : defaultPassForm(priorSteps)
    );
  }, [priorSteps]);

  const addInput = () => {
    if (!form.sourceStepId) return;
    onChange([
      ...passInputs,
      {
        sourceStepId: form.sourceStepId,
        data: form.data,
        field: (form.field || '').trim() || undefined,
        target: form.target,
        targetKey: (form.targetKey || '').trim() || undefined,
      },
    ]);
    setForm(defaultPassForm(priorSteps));
  };

  const removeInput = (i: number) => onChange(passInputs.filter((_, idx) => idx !== i));

  return (
    <div className="step-condition">
      <span className="field-label">Pass data from previous step into this request</span>

      {priorSteps.length > 0 && (
        <div className="pass-refs">
          <span className="pass-ref-title">
            References from earlier steps (use in URL/headers/body templates or the formula):
          </span>
          {priorSteps.map((p) => {
            const key = sanitizeLabel(p.label || p.id);
            return (
              <div className="pass-ref" key={p.id}>
                <span className="pass-ref-name">{p.label || p.id}:</span>
                <code>{`{{step.${key}.response}}`}</code>
                <code>{`{{stepRequest.${key}.url}}`}</code>
                <code>{`{{stepResponse.${key}.status}}`}</code>
              </div>
            );
          })}
        </div>
      )}

      <div className="pass-form">
        <select
          className="compact-select"
          aria-label="Source step"
          data-testid={`pass-source-${stepIndex}`}
          value={form.sourceStepId}
          onChange={(e) => setForm({ ...form, sourceStepId: e.target.value })}
        >
          <option value="">Select a step...</option>
          {priorSteps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label || p.id}
            </option>
          ))}
        </select>

        <select
          className="compact-select"
          aria-label="Pass data type"
          data-testid={`pass-data-${stepIndex}`}
          value={form.data}
          onChange={(e) => setForm({ ...form, data: e.target.value as StepPassInput['data'] })}
        >
          {PASS_DATA_LABELS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>

        <input
          className="text-input"
          type="text"
          placeholder="Field (e.g. id)"
          aria-label="Pass field path"
          data-testid={`pass-field-${stepIndex}`}
          value={form.field}
          onChange={(e) => setForm({ ...form, field: e.target.value })}
        />

        <select
          className="compact-select"
          aria-label="Pass target"
          data-testid={`pass-target-${stepIndex}`}
          value={form.target}
          onChange={(e) => setForm({ ...form, target: e.target.value as StepPassInput['target'] })}
        >
          {PASS_TARGET_LABELS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>

        <input
          className="text-input"
          type="text"
          placeholder="Key"
          aria-label="Pass destination key"
          data-testid={`pass-key-${stepIndex}`}
          value={form.targetKey}
          onChange={(e) => setForm({ ...form, targetKey: e.target.value })}
        />

        <button
          type="button"
          className="icon-button"
          aria-label="Add pass-through"
          title="Add pass-through"
          data-testid={`pass-add-${stepIndex}`}
          disabled={!form.sourceStepId}
          onClick={addInput}
        >
          <PlusIcon size={13} />
        </button>
      </div>

      {passInputs.length > 0 && (
        <ul className="pass-list">
          {passInputs.map((pi, i) => {
            const src = priorSteps.find((p) => p.id === pi.sourceStepId);
            return (
              <li key={i} className="pass-list-item" data-testid={`pass-item-${stepIndex}-${i}`}>
                <span>
                  {src ? src.label : pi.sourceStepId} · {pi.data}
                  {pi.field ? `.${pi.field}` : ''} → {pi.target}
                  {pi.targetKey ? `:${pi.targetKey}` : ''}
                </span>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label="Remove pass-through"
                  title="Remove pass-through"
                  data-testid={`pass-remove-${stepIndex}-${i}`}
                  onClick={() => removeInput(i)}
                >
                  <XIcon size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
        <WorkflowIcon size={28} />
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
        <button type="button" className="primary-button" data-testid="workflow-save-button" onClick={onSave} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <SaveIcon size={14} />
          Save workflow
        </button>
        <button type="button" className="ghost-button" data-testid="add-step-button" onClick={addStep} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <PlusIcon size={14} />
          Add step
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
            className={`step-card ${dragIndex === index ? 'dragging' : ''}`}
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
                <GripIcon size={14} />
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
                  title="Move step up"
                  disabled={index === 0}
                  onClick={() => moveStep(index, index - 1)}
                >
                  <ArrowUpIcon size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Move step down"
                  title="Move step down"
                  disabled={index === steps.length - 1}
                  onClick={() => moveStep(index, index + 1)}
                >
                  <ArrowDownIcon size={13} />
                </button>
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label="Remove step"
                  title="Remove step"
                  data-testid={`remove-step-button-${index}`}
                  onClick={() => removeStep(index)}
                >
                  <XIcon size={13} />
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

            <PassInputSection
              step={step}
              priorSteps={steps.slice(0, index)}
              stepIndex={index}
              onChange={(passInputs) => updateStep(index, { passInputs })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
