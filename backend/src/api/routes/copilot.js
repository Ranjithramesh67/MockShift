'use strict';

// ============================================================================
// AI copilot routes — mounted at /api/copilot (coordinator seam in server.js).
//
// Capabilities (all require an authenticated session + project read access,
// and all redact request/response inputs with redact.js BEFORE they are turned
// into a model prompt):
//   GET  /api/copilot/status            provider configured? (never the key)
//   POST /api/copilot/generate-assertions { requestId, response? }
//   POST /api/copilot/explain-run        { runId }
//   POST /api/copilot/generate-docs      { requestId }
//
// When USER_LLM_* is unconfigured the route returns 503 and llm.js performs no
// network call. Every attempt is recorded in ai_copilot_usage for audit.
// ============================================================================

const { Router } = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const { requireAuth, getProjectAccess } = require('../access');
const { redactRequestRecord, redactSnapshot } = require('../redact');
const llm = require('../llm');

const router = Router();
router.use(requireAuth);

const ASSERTION_TYPES = ['status', 'jsonPath', 'header', 'responseTime'];
const ASSERTION_OPERATORS = ['eq', 'neq', 'contains', 'gt', 'lt'];
const DOC_BLOCK_TYPES = ['heading', 'text', 'code', 'list'];
const MAX_ASSERTIONS = 20;
const MAX_BLOCKS = 40;

const ASSERTION_SYSTEM =
  'You are an API testing assistant. Propose response assertions for the given request and ' +
  'response snapshot. Reply with STRICT JSON only, shape: ' +
  '{"assertions":[{"type":"status|jsonPath|header|responseTime","operator":"eq|neq|contains|gt|lt",' +
  '"path":"dot.path.or.header.name (omit for status/responseTime)","expected":"string value"}]}. ' +
  'Do not include prose or markdown.';

const EXPLAIN_SYSTEM =
  'You are an API debugging assistant. Explain in plain language why the run failed. ' +
  'Reply with STRICT JSON only, shape: {"explanation":"..."} and reference concrete status/headers/body fields.';

const DOCS_SYSTEM =
  'You are an API documentation assistant. Produce a documentation block list describing the request. ' +
  'Reply with STRICT JSON only, shape: ' +
  '{"blocks":[{"type":"heading|text|code|list","content":{...}}]}. ' +
  'heading/text content is {text}; code content is {language,code}; list content is {style:"bullet|number",items:[string]}. ' +
  'Do not include prose or markdown outside the JSON.';

// --------------------------------------------------------------- input access
// A stored request joined to its collection/project/workspace, for access
// checks and (redacted) prompt construction.
async function requestContext(requestId) {
  const { rows } = await query(
    `SELECT ar.id, ar.name, ar.method, ar.url, ar.headers, ar.query_params,
            ar.body_type, ar.body_json, ar.body_text, ar.body_parts, ar.api_type,
            ar.assertions, ar.collection_id, c.project_id, p.workspace_id
       FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
       JOIN projects p ON p.id = c.project_id
      WHERE ar.id = $1`,
    [requestId]
  );
  return rows[0] || null;
}

// Build a request-shaped record and strip credentials before prompting.
function redactedRequestPayload(row) {
  return redactRequestRecord({
    name: row.name,
    method: row.method,
    url: row.url,
    headers: row.headers || [],
    query_params: row.query_params || [],
    body_type: row.body_type,
    body_json: row.body_json,
    body_text: row.body_text,
    body_parts: row.body_parts || [],
    api_type: row.api_type,
    existing_assertions: row.assertions || [],
  });
}

// --------------------------------------------------------------- parse helpers
function parseJsonLoose(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : trimmed).trim();
  const attempts = [candidate];
  const objStart = candidate.indexOf('{');
  const objEnd = candidate.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) attempts.push(candidate.slice(objStart, objEnd + 1));
  const arrStart = candidate.indexOf('[');
  const arrEnd = candidate.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) attempts.push(candidate.slice(arrStart, arrEnd + 1));
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try the next shape
    }
  }
  return null;
}

function normalizeAssertions(parsed) {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed && parsed.assertions)
      ? parsed.assertions
      : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const type = String(item.type || '');
    const operator = String(item.operator || '');
    if (!ASSERTION_TYPES.includes(type) || !ASSERTION_OPERATORS.includes(operator)) continue;
    const path = item.path == null ? item.name : item.path;
    if ((type === 'jsonPath' || type === 'header') && (path == null || String(path) === '')) continue;
    const assertion = {
      id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
      type,
      operator,
    };
    if (type === 'jsonPath' || type === 'header') assertion.path = String(path);
    assertion.expected = item.expected == null ? '' : String(item.expected);
    out.push(assertion);
    if (out.length >= MAX_ASSERTIONS) break;
  }
  return out;
}

function normalizeDocBlocks(parsed) {
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.blocks) ? parsed.blocks : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const type = String(item.type || '').toLowerCase();
    if (!DOC_BLOCK_TYPES.includes(type)) continue;
    const content = item.content && typeof item.content === 'object' ? item.content : {};
    if (type === 'heading' || type === 'text') {
      const text = typeof content.text === 'string' ? content.text : typeof item.text === 'string' ? item.text : '';
      if (!text.trim()) continue;
      out.push({ id: null, type, content: { text } });
    } else if (type === 'code') {
      const code = typeof content.code === 'string' ? content.code : '';
      if (!code.trim()) continue;
      const language = typeof content.language === 'string' && content.language ? content.language : 'text';
      out.push({ id: null, type: 'code', content: { language, code } });
    } else if (type === 'list') {
      const items = Array.isArray(content.items)
        ? content.items.map((i) => String(i)).filter((s) => s.trim() !== '')
        : [];
      if (items.length === 0) continue;
      const style = content.style === 'number' ? 'number' : 'bullet';
      out.push({ id: null, type: 'list', content: { style, items } });
    }
    if (out.length >= MAX_BLOCKS) break;
  }
  return out;
}

function coerceExplanation(text, parsed) {
  if (parsed && typeof parsed === 'object') {
    const value = parsed.explanation || parsed.summary || parsed.analysis;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  if (typeof text === 'string' && text.trim()) return text.trim();
  return '';
}

// ------------------------------------------------------------------ audit
async function recordUsage(entry) {
  try {
    await query(
      `INSERT INTO ai_copilot_usage
         (user_id, workspace_id, project_id, capability, provider, model, request_id, run_id,
          prompt_tokens, completion_tokens, total_tokens, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        entry.userId || null,
        entry.workspaceId || null,
        entry.projectId || null,
        entry.capability,
        entry.provider || null,
        entry.model || null,
        entry.requestId || null,
        entry.runId || null,
        entry.promptTokens == null ? null : entry.promptTokens,
        entry.completionTokens == null ? null : entry.completionTokens,
        entry.totalTokens == null ? null : entry.totalTokens,
        entry.status || 'ok',
        entry.error || null,
      ]
    );
  } catch (err) {
    // Auditing must never break a copilot response.
    // eslint-disable-next-line no-console
    console.error('[copilot] usage record failed:', err.message);
  }
}

// Run one capability through the model, normalizing the result and recording
// audit usage on both success and failure.
async function runCapability(capability, ctx, { system, prompt, config }) {
  try {
    const effective = config || (await llm.resolveConfig({ userId: ctx.userId, env: ctx.env }));
    const result = await llm.callModel({ system, prompt, json: true, config: effective });
    const text = typeof result === 'string' ? result : (result && result.text) || '';
    const usage = (result && result.usage) || {};
    const model = (result && result.model) || effective.model || null;
    const provider = (result && result.provider) || llm.PROVIDER_LABEL;
    await recordUsage({
      capability,
      status: 'ok',
      model,
      provider,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      requestId: ctx.requestId,
      runId: ctx.runId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
    return { text, usage, model, provider };
  } catch (err) {
    await recordUsage({
      capability,
      status: 'error',
      error: String((err && err.message) || err).slice(0, 500),
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      requestId: ctx.requestId,
      runId: ctx.runId,
    });
    throw err;
  }
}

function notConfigured(res) {
  return res.status(503).json({
    error: 'AI copilot is not configured. Set USER_LLM_API_KEY, USER_LLM_BASE_URL and USER_LLM_MODEL.',
    code: 'LLM_NOT_CONFIGURED',
  });
}

// ---------------------------------------------------------------- endpoints
// GET /api/copilot/status -> { configured, model, provider, source } (never the key).
router.get('/status', async (req, res, next) => {
  try {
    const cfg = await llm.resolveConfig({ userId: req.user.id });
    res.json(llm.describeResolved(cfg));
  } catch (err) {
    next(err);
  }
});

// POST /api/copilot/generate-assertions { requestId, response? }
router.post('/generate-assertions', async (req, res, next) => {
  try {
    const config = await llm.resolveConfig({ userId: req.user.id });
    if (!config.configured) return notConfigured(res);
    const { requestId, response } = req.body || {};
    if (!requestId) return res.status(400).json({ error: 'requestId is required' });

    const row = await requestContext(requestId);
    if (!row) return res.status(404).json({ error: 'Request not found' });
    const access = await getProjectAccess(req.user.id, row.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this request' });

    let responseSnapshot = response || null;
    if (!responseSnapshot) {
      const { rows } = await query(
        `SELECT response_snapshot FROM run_history
          WHERE request_id = $1 AND response_snapshot IS NOT NULL
          ORDER BY started_at DESC LIMIT 1`,
        [requestId]
      );
      responseSnapshot = rows[0] ? rows[0].response_snapshot : null;
    }
    if (!responseSnapshot) {
      return res.status(400).json({ error: 'response snapshot is required (pass response or run the request first)' });
    }

    const redactedRequest = redactedRequestPayload(row);
    const redactedResponse = redactSnapshot(responseSnapshot, {});
    const prompt =
      'Request:\n' + JSON.stringify(redactedRequest, null, 2) +
      '\n\nResponse snapshot:\n' + JSON.stringify(redactedResponse, null, 2) +
      '\n\nPropose assertions that capture the important behaviour of this response.';

    const result = await runCapability('generate-assertions', {
      userId: req.user.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      requestId,
    }, { system: ASSERTION_SYSTEM, prompt, config });

    res.json({
      assertions: normalizeAssertions(parseJsonLoose(result.text)),
      usage: result.usage,
      model: result.model,
      provider: result.provider,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/copilot/explain-run { runId }
router.post('/explain-run', async (req, res, next) => {
  try {
    const config = await llm.resolveConfig({ userId: req.user.id });
    if (!config.configured) return notConfigured(res);
    const { runId } = req.body || {};
    if (!runId) return res.status(400).json({ error: 'runId is required' });

    const { rows } = await query(
      `SELECT rh.id, rh.user_id, rh.request_id, rh.trigger, rh.status, rh.started_at, rh.finished_at,
              rh.request_snapshot, rh.response_snapshot,
              ar.collection_id, c.project_id, p.workspace_id,
              COALESCE(ar.name, wc.name, '(deleted)') AS name
         FROM run_history rh
         LEFT JOIN api_requests ar ON ar.id = rh.request_id
         LEFT JOIN collections c ON c.id = ar.collection_id
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN workflow_chains wc ON wc.id = rh.workflow_id
        WHERE rh.id = $1`,
      [runId]
    );
    const run = rows[0];
    if (!run) return res.status(404).json({ error: 'Run not found' });

    let allowed = run.user_id === req.user.id;
    if (!allowed && run.project_id) {
      allowed = Boolean(await getProjectAccess(req.user.id, run.project_id));
    }
    if (!allowed) return res.status(404).json({ error: 'Run not found' });

    const { rows: tests } = await query(
      `SELECT test_name, passed, assertions, error
         FROM test_results WHERE run_id = $1 ORDER BY test_name`,
      [runId]
    );

    const payload = {
      name: run.name,
      trigger: run.trigger,
      status: run.status,
      started_at: run.started_at,
      finished_at: run.finished_at,
      request: run.request_snapshot ? redactSnapshot(run.request_snapshot, {}) : null,
      response: run.response_snapshot ? redactSnapshot(run.response_snapshot, {}) : null,
      test_results: tests,
    };
    const prompt =
      'Run record:\n' + JSON.stringify(payload, null, 2) +
      '\n\nExplain why this run failed (or edge cases worth noting if it passed).';

    const result = await runCapability('explain-run', {
      userId: req.user.id,
      workspaceId: run.workspace_id,
      projectId: run.project_id,
      requestId: run.request_id,
      runId,
    }, { system: EXPLAIN_SYSTEM, prompt, config });

    res.json({
      explanation: coerceExplanation(result.text, parseJsonLoose(result.text)),
      usage: result.usage,
      model: result.model,
      provider: result.provider,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/copilot/generate-docs { requestId }
router.post('/generate-docs', async (req, res, next) => {
  try {
    const config = await llm.resolveConfig({ userId: req.user.id });
    if (!config.configured) return notConfigured(res);
    const { requestId } = req.body || {};
    if (!requestId) return res.status(400).json({ error: 'requestId is required' });

    const row = await requestContext(requestId);
    if (!row) return res.status(404).json({ error: 'Request not found' });
    const access = await getProjectAccess(req.user.id, row.project_id);
    if (!access) return res.status(403).json({ error: 'No access to this request' });

    const redactedRequest = redactedRequestPayload(row);
    const prompt =
      'Request:\n' + JSON.stringify(redactedRequest, null, 2) +
      '\n\nWrite a concise documentation section describing this endpoint: a heading, ' +
      'a short overview, an example request (code block) and any notes as a list.';

    const result = await runCapability('generate-docs', {
      userId: req.user.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      requestId,
    }, { system: DOCS_SYSTEM, prompt, config });

    res.json({
      blocks: normalizeDocBlocks(parseJsonLoose(result.text)),
      usage: result.usage,
      model: result.model,
      provider: result.provider,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
