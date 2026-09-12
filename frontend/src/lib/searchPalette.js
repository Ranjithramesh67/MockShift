'use strict';

const LABELS = {
  workspace: 'Workspaces',
  project: 'Projects',
  collection: 'Collections',
  folder: 'Folders',
  request: 'Requests',
  doc: 'Docs',
  contract: 'Contracts',
  monitor: 'Monitors',
  mockScenario: 'Mock scenarios',
  workflow: 'Workflows',
};

function groupLabel(type) {
  return LABELS[type] || 'Other';
}

function takeTop(rows, n) {
  return (rows || []).slice(0, n);
}

function flattenResults(results) {
  return (results || []).slice();
}

module.exports = { groupLabel, takeTop, flattenResults };
