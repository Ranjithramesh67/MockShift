'use strict';

/**
 * Workflow validation, with infinite-loop detection.
 *
 * A workflow is rejected when:
 *  - a fixed-count loop is negative, zero, fractional or infinite;
 *  - an `until` loop has an empty condition (it can never become false);
 *  - an `until` loop condition references the looped step's own result, which
 *    is frozen while the step is looping, so the loop can never terminate;
 *  - the aggregate worst-case iteration count exceeds a safety cap, so a
 *    cascading set of loops cannot spin the engine forever.
 */

const MAX_TOTAL_ITERATIONS = 1000;

function stepLabel(step) {
  return step.label || step.id || '(unnamed step)';
}

function stepReferences(condition) {
  const refs = [];
  const regex = /\$steps(?:\['([^']+)'\]|\["([^"]+)"\]|\.([A-Za-z0-9_]+))/g;
  let match;
  while ((match = regex.exec(condition)) !== null) {
    refs.push(match[1] || match[2] || match[3]);
  }
  return refs;
}

/**
 * Validate a workflow definition.
 *
 * @param {{ id: string, name: string, steps: import('../lib/types').WorkflowStep[] }} workflow
 * @returns {{ valid: boolean, errors: Array<{ stepId: string|null, message: string }> }}
 */
function validateWorkflow(workflow) {
  const errors = [];
  const name = (workflow.name || '').trim();
  if (!name) {
    errors.push({ stepId: null, message: 'Workflow name is required.' });
  }
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    errors.push({ stepId: null, message: 'Workflow must contain at least one step.' });
    return { valid: errors.length === 0, errors };
  }

  const seen = new Set();
  let totalIterations = 0;

  for (const step of workflow.steps) {
    const label = stepLabel(step);
    if (seen.has(step.id)) {
      errors.push({ stepId: step.id, message: `Duplicate step id "${step.id}".` });
    }
    seen.add(step.id);

    if (!step.requestId) {
      errors.push({ stepId: step.id, message: `Step "${label}" has no request selected.` });
    }
    if (!Number.isFinite(step.delayMs) || step.delayMs < 0) {
      errors.push({
        stepId: step.id,
        message: `Step "${label}" delay must be a non-negative number of milliseconds.`,
      });
    }

    const loop = step.loop || { type: 'none' };
    if (loop.type === 'count') {
      const count = loop.count;
      if (!Number.isInteger(count) || count < 1) {
        errors.push({
          stepId: step.id,
          message:
            `Step "${label}" loop count must be a whole number of at least 1; ` +
            `a count of ${count} would produce an infinite or non-terminating loop.`,
        });
      } else {
        totalIterations += count;
      }
    } else if (loop.type === 'until') {
      const condition = (loop.condition || '').trim();
      if (!condition) {
        errors.push({
          stepId: step.id,
          message: `Step "${label}" loops until a condition but the condition is empty - the loop would run forever.`,
        });
      } else if (stepReferences(condition).includes(step.id)) {
        errors.push({
          stepId: step.id,
          message:
            `Step "${label}" loop condition references its own result, which never changes while ` +
            `the step is looping - the loop would run forever.`,
        });
      } else {
        // Worst case: an `until` loop is bounded only by the global safety cap.
        totalIterations += MAX_TOTAL_ITERATIONS;
      }
    }
  }

  if (totalIterations > MAX_TOTAL_ITERATIONS) {
    errors.push({
      stepId: null,
      message:
        `Workflow could iterate up to ${totalIterations} times, exceeding the safe limit of ` +
        `${MAX_TOTAL_ITERATIONS}.`,
    });
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateWorkflow, stepReferences, MAX_TOTAL_ITERATIONS };
