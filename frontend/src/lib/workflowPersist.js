'use strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPersistedWorkflowId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

function workflowToDefinition(workflow) {
  const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
  return { steps };
}

function storedToWorkflow(stored) {
  const steps = Array.isArray(stored && stored.definition && stored.definition.steps)
    ? stored.definition.steps
    : [];
  return {
    id: stored && stored.id,
    name: stored && stored.name,
    steps,
  };
}

async function persistWorkflow({ workflow, projectId, api }) {
  if (!projectId) {
    throw new Error('A project is required to save a workflow.');
  }
  const name = String((workflow && workflow.name) || '').trim();
  const definition = workflowToDefinition(workflow);
  if (isPersistedWorkflowId(workflow && workflow.id)) {
    const res = await api.update(workflow.id, { name, definition });
    return storedToWorkflow(res.workflow);
  }
  const res = await api.create({ projectId, name, definition });
  return storedToWorkflow(res.workflow);
}

async function deletePersistedWorkflow({ workflowId, api }) {
  if (!isPersistedWorkflowId(workflowId)) {
    return { localOnly: true };
  }
  await api.remove(workflowId);
  return { localOnly: false };
}

function isUntitledName(name) {
  const trimmed = String(name || '').trim();
  return trimmed === '' || trimmed.toLowerCase() === 'untitled workflow';
}

function mergeLoadedWorkflows(serverWorkflows, localWorkflows) {
  const localOnly = (localWorkflows || []).filter((w) => !isPersistedWorkflowId(w && w.id));
  if (!serverWorkflows || serverWorkflows.length === 0) {
    return localOnly;
  }
  const untitled = localOnly.filter((w) => isUntitledName(w && w.name));
  return serverWorkflows.concat(untitled);
}

module.exports = {
  isPersistedWorkflowId,
  workflowToDefinition,
  storedToWorkflow,
  persistWorkflow,
  deletePersistedWorkflow,
  mergeLoadedWorkflows,
};
