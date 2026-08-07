'use strict';

const { randomUUID } = require('crypto');
const { Queue, Worker } = require('bullmq');

function parseBody(body) {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

// Turns a step label into a template-safe, dot-path-addressable key.
// "Create User" -> "create_user"; "GET /posts" -> "get_posts".
function sanitizeLabel(label) {
  const key = String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'step';
}

const MAX_LOOP_ITERATIONS = 1000;

// Normalizes the UI's loop shape ({ type: 'count'|'until', ... }) and the
// legacy numeric form into a single config, or null when there is no loop.
function getLoopConfig(step) {
  const loop = step && step.loop;
  if (typeof loop === 'number') return { type: 'count', count: Math.max(0, loop) };
  if (loop && typeof loop === 'object') {
    if (loop.type === 'count') {
      return { type: 'count', count: Math.max(0, Number(loop.count) || 0) };
    }
    if (loop.type === 'until') {
      return { type: 'until', condition: loop.condition };
    }
  }
  return null;
}

function summarizeSteps(steps) {
  const summary = {};
  for (const [key, value] of Object.entries(steps || {})) {
    const id = key.split('#')[0];
    if (!summary[id]) {
      summary[id] = {
        status: value.status,
        request: value.request,
        response: value.response,
        error: value.error,
        startedAt: value.startedAt,
        finishedAt: value.finishedAt,
      };
    }
  }
  return summary;
}

class WorkflowEngine {
  constructor({
    name = 'default',
    dispatcher,
    sandbox,
    workflowRepository,
    runStore,
    connection,
    logger = console,
  }) {
    this.name = name;
    this.dispatcher = dispatcher;
    this.sandbox = sandbox;
    this.workflowRepository = workflowRepository;
    this.runStore = runStore;
    this.logger = logger;
    this.closed = false;
    const queueName = `apihub_wf_${name}_exec`;
    this.queue = new Queue(queueName, { connection });
    this.worker = new Worker(queueName, (job) => this.process(job), {
      connection,
      concurrency: 5,
    });
  }

  async start({ workflowId, inputVars = {}, trigger = 'MANUAL', userId = null }) {
    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    if (!workflow.steps || workflow.steps.length === 0) {
      throw new Error(`Workflow has no steps: ${workflowId}`);
    }
    const runId = randomUUID();
    const state = {
      workflowId,
      runId,
      trigger,
      vars: { ...inputVars },
      steps: {},
      stepIndex: 0,
      iteration: 0,
    };
    await this.runStore.create({
      id: runId,
      workflowId,
      trigger,
      status: 'PENDING',
      startedAt: new Date().toISOString(),
      userId,
    });
    const first = workflow.steps[0];
    await this.enqueueStep(workflow, 0, 0, state, first.delayMs || 0);
    return runId;
  }

  async enqueueStep(workflow, stepIndex, iteration, state, delayMs) {
    const step = workflow.steps[stepIndex];
    await this.queue.add(
      step.id,
      { workflowId: workflow.id, runId: state.runId, stepIndex, iteration, state },
      { delay: delayMs || 0, jobId: `${state.runId}:${stepIndex}:${iteration}` }
    );
  }

  async continue(workflow, state) {
    if (state.stepIndex >= workflow.steps.length) {
      return this.finalize(workflow, state, 'SUCCESS');
    }
    const step = workflow.steps[state.stepIndex];
    return this.enqueueStep(workflow, state.stepIndex, state.iteration, state, step.delayMs || 0);
  }

  async finalize(workflow, state, status) {
    const run = await this.runStore.update(state.runId, {
      status,
      finishedAt: new Date().toISOString(),
      steps: state.steps,
      vars: state.vars,
    });
    this.logger.info(`workflow ${workflow.id} (run ${state.runId}) finished: ${status}`);
    return run;
  }

  async evaluateCondition(step, state) {
    if (!step.condition) return null;
    const outcome = await this.sandbox.run({
      source: step.condition,
      req: {},
      vars: state.vars,
      globals: { $steps: summarizeSteps(state.steps) },
    });
    return Boolean(outcome.returned);
  }

  async handleFailure(workflow, state) {
    const failingStep = workflow.steps[state.stepIndex];
    if (failingStep && failingStep.onFailure === 'skip') {
      await this.continue(workflow, { ...state, stepIndex: state.stepIndex + 1, iteration: 0 });
      return { handled: 'skip' };
    }
    await this.finalize(workflow, state, 'FAILED');
    return { handled: 'abort' };
  }

  async process(job) {
    const { workflowId, runId, stepIndex, iteration, state } = job.data;
    const workflow = await this.workflowRepository.findById(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }
    const step = workflow.steps[stepIndex];
    if (!step) {
      throw new Error(`Step ${stepIndex} missing in workflow ${workflowId}`);
    }
    const stepKey = `${step.id}#${iteration}`;
    const startedAt = new Date().toISOString();
    state.steps[stepKey] = { status: 'RUNNING', startedAt };

    let conditionMet;
    try {
      conditionMet = await this.evaluateCondition(step, state);
    } catch (err) {
      state.steps[stepKey] = {
        status: 'FAILED',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: `condition: ${String(err.message || err)}`,
      };
      await this.handleFailure(workflow, state);
      return { step: step.id, status: 'FAILED', handled: 'condition-error' };
    }

    if (conditionMet === false) {
      state.steps[stepKey] = {
        status: 'SKIPPED',
        startedAt,
        finishedAt: new Date().toISOString(),
        reason: 'condition',
      };
      await this.continue(workflow, { ...state, stepIndex: stepIndex + 1, iteration: 0 });
      return { step: step.id, status: 'SKIPPED' };
    }

    let run;
    try {
      run = await this.dispatcher.execute({
        requestId: step.requestId,
        environmentId: step.environmentId,
        trigger: state.trigger || 'MANUAL',
        vars: state.vars,
        persistVars: false,
        formula: step.formula,
        passInputs: step.passInputs,
      });
    } catch (err) {
      state.steps[stepKey] = {
        status: 'FAILED',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: String(err.message || err),
      };
      await this.handleFailure(workflow, state);
      return { step: step.id, status: 'FAILED', handled: 'error' };
    }

    const success = run.status === 'SUCCESS';
    state.steps[stepKey] = {
      status: success ? 'SUCCESS' : 'FAILED',
      startedAt,
      finishedAt: new Date().toISOString(),
      request: run.requestSnapshot,
      response: run.responseSnapshot,
      error: success ? undefined : `HTTP ${run.responseSnapshot ? run.responseSnapshot.status : 'unknown'}`,
    };

    if (!success) {
      await this.handleFailure(workflow, state);
      return { step: step.id, status: 'FAILED', handled: 'http' };
    }

    // Expose this step's request + response to subsequent steps under friendly,
    // label-based keys so they can be templated ({{step.<label>.id}}) or read
    // from formulas (vars.step.<label>.id). `vars[step.id]` stays for backward
    // compatibility.
    const responseBody = parseBody(run.responseSnapshot.body);
    const labelKey = sanitizeLabel(step.label || step.id);
    state.vars = {
      ...(run.vars || {}),
      [step.id]: responseBody,
      step: {
        ...(state.vars.step || {}),
        [step.id]: responseBody,
        [labelKey]: responseBody,
      },
      stepRequest: {
        ...(state.vars.stepRequest || {}),
        [step.id]: run.requestSnapshot,
        [labelKey]: run.requestSnapshot,
      },
      stepResponse: {
        ...(state.vars.stepResponse || {}),
        [step.id]: run.responseSnapshot,
        [labelKey]: run.responseSnapshot,
      },
    };

    const loopConfig = getLoopConfig(step);
    const nextIteration = iteration + 1;
    if (loopConfig) {
      if (loopConfig.type === 'count') {
        if (nextIteration < loopConfig.count) {
          await this.enqueueStep(workflow, stepIndex, nextIteration, state, step.loopDelayMs || 0);
          return { step: step.id, status: 'SUCCESS', iteration: nextIteration };
        }
      } else if (loopConfig.type === 'until') {
        if (nextIteration >= MAX_LOOP_ITERATIONS) {
          this.logger.warn(`workflow ${workflow.id} run ${state.runId}: until-loop on step ${step.id} hit safety cap`);
        } else {
          let keepGoing = false;
          try {
            keepGoing = await this.evaluateCondition({ condition: loopConfig.condition }, state);
          } catch (err) {
            state.steps[stepKey] = {
              status: 'FAILED',
              startedAt,
              finishedAt: new Date().toISOString(),
              error: `until-loop condition: ${String(err.message || err)}`,
            };
            await this.handleFailure(workflow, state);
            return { step: step.id, status: 'FAILED', handled: 'loop-condition-error' };
          }
          if (keepGoing) {
            await this.enqueueStep(workflow, stepIndex, nextIteration, state, step.loopDelayMs || 0);
            return { step: step.id, status: 'SUCCESS', iteration: nextIteration };
          }
        }
      }
    }

    await this.continue(workflow, { ...state, stepIndex: stepIndex + 1, iteration: 0 });
    return { step: step.id, status: 'SUCCESS' };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.worker.close();
    await this.queue.close();
  }
}

module.exports = { WorkflowEngine, parseBody, summarizeSteps, getLoopConfig, sanitizeLabel };
