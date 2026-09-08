'use strict';

// ============================================================================
// Docs — a Confluence-style documentation feature for a workspace (and,
// optionally, one of its projects). Also hosts the workspace-access-request
// flow (request access -> admin approves/denies -> requester becomes a VIEWER).
//
// Mount point (coordinator seam in backend/src/api/server.js):
//   app.use('/api/docs', require('./routes/docs'));
//
// Access model mirrors access.js:
//   read    -> canReadWorkspace(workspaceId) OR platform MANAGER/ADMIN
//   edit    -> page author OR workspace role >= EDITOR OR platform
//              MANAGER/ADMIN  ("canEdit")
//   delete  -> page author OR workspace role >= ADMIN OR platform
//              MANAGER/ADMIN
//   review workspace-access-requests -> workspace role >= ADMIN OR platform
//              MANAGER/ADMIN
//
// Page bodies are a flat position-ordered block list; PUT /docs/:pageId/blocks
// replaces the whole list (positions reassigned 0..n-1 server-side). Blocks
// the client references by id but that are not children of the page are
// pruned rather than created.
// ============================================================================

const { Router } = require('express');
const crypto = require('crypto');
const { query, pool } = require('../db');
const {
  requireAuth,
  roleAtLeast,
  getWorkspaceRole,
  getProjectAccess,
  canReadWorkspace,
} = require('../access');
const { logAudit } = require('../audit');
const {
  checkPublicSharingGate,
  checkCountGate,
  orgOfWorkspace,
  resolveLimits,
  countPoolUsage,
} = require('../entitlements');

const router = Router();

// Public share viewer — mounted BEFORE requireAuth so holding a doc share
// token alone grants a sanitized read (never ids/emails/workspace ids).
const publicDocRouter = Router();
publicDocRouter.get('/:token', servePublicDocShare);
router.use('/public', publicDocRouter);

router.use(requireAuth);

// Workspace-access-request routes live on their own sub-router mounted at
// /workspace-access-requests so the single-segment routes (:pageId, ...) can
// never shadow them regardless of declaration order.
const accessRequestRouter = Router();
accessRequestRouter.use(requireAuth);

// Mount before any single-segment page route (:pageId) so these dedicated
// paths can never be shadowed by a page lookup.
router.use('/workspace-access-requests', accessRequestRouter);

const BLOCK_TYPES = ['heading', 'text', 'code', 'payload', 'response', 'schema', 'list', 'image'];
const IMG_SIZES = ['small', 'medium', 'large', 'full'];
// Display width (% of the content column) per image size preset. Shared intent
// with the frontend (docs.module.css / BlockView + BlockEditor size control).
const IMG_SIZE_PCT = { small: 34, medium: 55, large: 80, full: 100 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Platform MANAGER/ADMIN users act as workspace admins everywhere.
function isGlobalHigh(user) {
  return Boolean(user) && roleAtLeast(user.role, 'MANAGER');
}

// Effective workspace access for the caller:
//   { role: 'ADMIN'|'MANAGER'|'EDITOR'|'VIEWER'|null, readable: boolean }
// readable follows access.js canReadWorkspace (direct/team/org-admin
// membership, PUBLIC visibility within an org, project grants) or the platform
// MANAGER/ADMIN bypass.
async function workspaceAccessFor(user, workspaceId) {
  if (isGlobalHigh(user)) return { role: 'ADMIN', readable: true };
  const role = await getWorkspaceRole(user.id, workspaceId);
  const readable = Boolean(role) || (await canReadWorkspace(user.id, workspaceId));
  return { role, readable };
}

async function pageRow(pageId) {
  const { rows } = await query(
    `SELECT p.id, p.workspace_id, p.project_id, p.title, p.created_by, p.updated_by,
            p.created_at, p.updated_at
       FROM doc_pages p WHERE p.id = $1`,
    [pageId]
  );
  return rows[0] || null;
}

// ----------------------------------------------------------- Serialization
// Page summary: {id,title,workspaceId,workspaceName,projectId,projectName,
// createdBy:{id,name},updatedBy:null|{id,name},createdAt,updatedAt,blockCount}
async function serializePageSummary(row) {
  const { rows } = await query(
    `SELECT w.name AS workspace_name, pr.name AS project_name,
            cb.name AS created_by_name, ub.name AS updated_by_name,
            (SELECT count(*)::int FROM doc_blocks db WHERE db.page_id = p.id) AS block_count
       FROM doc_pages p
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN projects pr ON pr.id = p.project_id
       JOIN users cb ON cb.id = p.created_by
       LEFT JOIN users ub ON ub.id = p.updated_by
      WHERE p.id = $1`,
    [row.id]
  );
  const s = rows[0];
  return {
    id: row.id,
    title: row.title,
    workspaceId: row.workspace_id,
    workspaceName: s.workspace_name,
    projectId: row.project_id ?? null,
    projectName: s.project_name ?? null,
    createdBy: { id: row.created_by, name: s.created_by_name },
    updatedBy: row.updated_by ? { id: row.updated_by, name: s.updated_by_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    blockCount: s.block_count,
  };
}

// canEdit = author OR workspace role >= EDITOR OR platform MANAGER/ADMIN.
async function canEditPage(user, page) {
  if (page.created_by === user.id) return true;
  const access = await workspaceAccessFor(user, page.workspace_id);
  return roleAtLeast(access.role, 'EDITOR');
}

async function canDeletePage(user, page) {
  if (page.created_by === user.id) return true;
  const access = await workspaceAccessFor(user, page.workspace_id);
  return roleAtLeast(access.role, 'ADMIN');
}

// Mention: {id,type,refId,ref:{...}}. User refs resolve to {id,name,email};
// api refs to {id,name,method,collectionId,workspaceId,projectId,access:{read}}.
async function serializeMention(row, viewer) {
  const base = {
    id: row.id,
    type: row.mention_type,
    refId: row.ref_id,
  };
  if (row.mention_type === 'user') {
    const { rows } = await query(`SELECT id, name, email FROM users WHERE id = $1`, [row.ref_id]);
    const u = rows[0];
    return { ...base, ref: u ? { id: u.id, name: u.name, email: u.email } : { id: row.ref_id, name: null, email: null } };
  }
  const { rows } = await query(
    `SELECT ar.id, ar.name, ar.method, ar.collection_id, c.project_id, p.workspace_id
       FROM api_requests ar
       JOIN collections c ON c.id = ar.collection_id
       JOIN projects p ON p.id = c.project_id
      WHERE ar.id = $1`,
    [row.ref_id]
  );
  const api = rows[0];
  if (!api) return { ...base, ref: null };
  const access = await getProjectAccess(viewer.id, api.project_id);
  return {
    ...base,
    ref: {
      id: api.id,
      name: api.name,
      method: api.method,
      collectionId: api.collection_id,
      workspaceId: api.workspace_id,
      projectId: api.project_id,
      access: { read: Boolean(access) },
    },
  };
}

// ------------------------------------------------ Block content validation
// Each block_type requires its content keys; anything else is a 400.
function blockContentError(type, content) {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    return 'content must be an object';
  }
  switch (type) {
    case 'heading':
    case 'text':
      if (typeof content.text !== 'string') return `${type} content requires text`;
      return null;
    case 'code':
      if (typeof content.language !== 'string') return 'code content requires language';
      if (typeof content.code !== 'string') return 'code content requires code';
      return null;
    case 'payload':
      if (typeof content.method !== 'string' || !('contentType' in content) || !('body' in content)) {
        return 'payload content requires method, contentType and body';
      }
      return null;
    case 'response':
      if (typeof content.status !== 'number' || !('body' in content)) {
        return 'response content requires status and body';
      }
      return null;
    case 'schema':
      if (typeof content.language !== 'string' || !('definition' in content)) {
        return 'schema content requires language and definition';
      }
      return null;
    case 'list':
      if (!['bullet', 'number'].includes(content.style)) {
        return 'list content style must be bullet or number';
      }
      if (!Array.isArray(content.items) || content.items.some((i) => typeof i !== 'string')) {
        return 'list content items must be an array of strings';
      }
      return null;
    case 'image':
      if (typeof content.src !== 'string' || !String(content.src).trim()) {
        return 'image content requires a non-empty src';
      }
      if (!/^https?:\/\//i.test(content.src) && !/^data:image\//i.test(content.src)) {
        return 'image content src must be an http(s) URL or a data:image data URL';
      }
      if (content.alt !== undefined && content.alt !== null && typeof content.alt !== 'string') {
        return 'image content alt must be a string';
      }
      if (content.caption !== undefined && content.caption !== null && typeof content.caption !== 'string') {
        return 'image content caption must be a string';
      }
      if (
        content.size !== undefined &&
        content.size !== null &&
        !IMG_SIZES.includes(content.size)
      ) {
        return `image content size must be one of ${IMG_SIZES.join(', ')}`;
      }
      return null;
    default:
      return `block_type must be one of ${BLOCK_TYPES.join(', ')}`;
  }
}

async function notifyUser({ userId, title, body, kind }) {
  try {
    await query(
      `INSERT INTO notifications (user_id, title, body, kind) VALUES ($1, $2, $3, $4)`,
      [userId, title, body || null, kind || 'info']
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[docs] notification insert failed:', err.message);
  }
}

// ================================================================ Pages

// GET /docs?workspaceId=<uuid>[&projectId=<uuid>][&q=text] -> 200 {pages:[...]}
// Caller must be able to read the workspace.
router.get('/', async (req, res, next) => {
  try {
    const { workspaceId, projectId, q } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
    if (projectId && !isUuid(projectId)) {
      return res.status(400).json({ error: 'projectId must be a valid uuid' });
    }
    const access = await workspaceAccessFor(req.user, workspaceId);
    if (!access.readable) return res.status(403).json({ error: 'No access to this workspace' });

    const { rows } = await query(
      `SELECT p.id, p.title, p.workspace_id, w.name AS workspace_name, p.project_id,
              pr.name AS project_name, p.created_by, cb.name AS created_by_name,
              p.updated_by, ub.name AS updated_by_name, p.created_at, p.updated_at,
              (SELECT count(*)::int FROM doc_blocks db WHERE db.page_id = p.id) AS block_count
         FROM doc_pages p
         JOIN workspaces w ON w.id = p.workspace_id
         LEFT JOIN projects pr ON pr.id = p.project_id
         JOIN users cb ON cb.id = p.created_by
         LEFT JOIN users ub ON ub.id = p.updated_by
        WHERE p.workspace_id = $1
          AND ($2::uuid IS NULL OR p.project_id = $2)
          AND ($3::text IS NULL OR p.title ILIKE '%' || $3 || '%')
        ORDER BY p.updated_at DESC`,
      [workspaceId, projectId || null, (q && String(q).trim()) || null]
    );
    const pages = rows.map((r) => ({
      id: r.id,
      title: r.title,
      workspaceId: r.workspace_id,
      workspaceName: r.workspace_name,
      projectId: r.project_id ?? null,
      projectName: r.project_name ?? null,
      createdBy: { id: r.created_by, name: r.created_by_name },
      updatedBy: r.updated_by ? { id: r.updated_by, name: r.updated_by_name } : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      blockCount: r.block_count,
    }));
    res.json({ pages });
  } catch (err) {
    next(err);
  }
});

// POST /docs {workspaceId, projectId?, title} -> 201 {page}
// Requires workspace read + role >= EDITOR. Auto-creates the leading heading
// block (content {text: title}).
router.post('/', async (req, res, next) => {
  try {
    const { workspaceId, projectId, title } = req.body || {};
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
    const cleanTitle = title === undefined || title === null ? '' : String(title).trim();
    if (!cleanTitle) return res.status(400).json({ error: 'title is required' });

    const ws = await query(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
    if (ws.rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });
    const access = await workspaceAccessFor(req.user, workspaceId);
    if (!access.readable) return res.status(403).json({ error: 'No access to this workspace' });
    if (!roleAtLeast(access.role, 'EDITOR')) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }

    let resolvedProjectId = null;
    if (projectId) {
      if (!isUuid(projectId)) return res.status(400).json({ error: 'projectId must be a valid uuid' });
      const proj = await query(`SELECT id FROM projects WHERE id = $1 AND workspace_id = $2`, [
        projectId,
        workspaceId,
      ]);
      if (proj.rows.length === 0) {
        return res.status(400).json({ error: 'Project does not belong to this workspace' });
      }
      resolvedProjectId = projectId;
    }

    // doc_pages are counted against the org pool plan (R4 creation-only gate).
    const docGate = await checkCountGate({
      userId: req.user.id,
      orgId: await orgOfWorkspace(workspaceId),
      key: 'doc_pages',
    });
    if (docGate) return res.status(403).json(docGate);

    const created = await query(
      `INSERT INTO doc_pages (workspace_id, project_id, title, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, workspace_id, project_id, title, created_by, updated_by, created_at, updated_at`,
      [workspaceId, resolvedProjectId, cleanTitle, req.user.id]
    );
    const page = created.rows[0];
    await query(
      `INSERT INTO doc_blocks (page_id, position, block_type, content) VALUES ($1, 0, 'heading', $2)`,
      [page.id, JSON.stringify({ text: cleanTitle })]
    );
    const summary = await serializePageSummary(page);
    res.status(201).json({ page: { ...summary, canEdit: true } });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ Usage

// GET /docs/usage?workspaceId=<uuid> -> 200
// { planKey, planName, enforced, usage: { doc_pages, api_requests,
// mock_servers }, limits: { doc_pages, api_requests, mock_servers } }
// Auth + workspace read gate. Declared before /:pageId so "usage" is never
// shadowed by a page lookup.
router.get('/usage', async (req, res, next) => {
  try {
    const { workspaceId } = req.query;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
    const access = await workspaceAccessFor(req.user, workspaceId);
    if (!access.readable) return res.status(403).json({ error: 'No access to this workspace' });
    const orgId = await orgOfWorkspace(workspaceId);
    const [en, usage] = await Promise.all([resolveLimits(req.user.id, orgId), countPoolUsage(orgId)]);
    res.json({
      planKey: en.planKey,
      planName: en.planName,
      enforced: en.enforced,
      usage: {
        doc_pages: usage.doc_pages ?? 0,
        api_requests: usage.api_requests ?? 0,
        mock_servers: usage.mock_servers ?? 0,
      },
      limits: {
        doc_pages: en.limits.doc_pages ?? null,
        api_requests: en.limits.api_requests ?? null,
        mock_servers: en.limits.mock_servers ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------- Export (download)

// Renderers for the three export formats. All text goes through esc() in HTML;
// markdown keeps raw text as-is (safe, no HTML is produced). Blocks whose
// content lacks a key degrade to '' rather than throwing.
function escHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prettyBody(body) {
  if (typeof body === 'string') return body;
  if (body === null || body === undefined) return '';
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function blockToMarkdown(b) {
  const c = b.content || {};
  switch (b.type) {
    case 'heading':
      return `## ${c.text ?? ''}`;
    case 'text':
      return c.text ?? '';
    case 'code':
      return `\`\`\`${c.language || ''}\n${c.code ?? ''}\n\`\`\``;
    case 'schema':
      return `\`\`\`${c.language || ''}\n${prettyBody(c.definition)}\n\`\`\``;
    case 'payload': {
      const method = String(c.method || '').toUpperCase();
      const lines = [`### Payload ${method}`];
      if (typeof c.contentType === 'string' && c.contentType) {
        lines.push(`Content-Type: ${c.contentType}`, '');
      }
      lines.push('```json', prettyBody(c.body), '```');
      return lines.join('\n');
    }
    case 'response':
      return `### Example response (${c.status})\n\n\`\`\`json\n${prettyBody(c.body)}\n\`\`\``;
    case 'list': {
      const items = Array.isArray(c.items) ? c.items : [];
      if (c.style === 'number') return items.map((it, i) => `${i + 1}. ${it}`).join('\n');
      return items.map((it) => `- ${it}`).join('\n');
    }
    case 'image': {
      const alt = typeof c.alt === 'string' ? c.alt : '';
      const caption = typeof c.caption === 'string' && c.caption ? ` *${c.caption}*` : '';
      return `![${alt}](${c.src})${caption}`;
    }
    default:
      return '';
  }
}

function blockToHtml(b) {
  const c = b.content || {};
  switch (b.type) {
    case 'heading':
      return `<h2>${escHtml(c.text)}</h2>`;
    case 'text':
      return `<p>${escHtml(c.text)}</p>`;
    case 'code':
      return `<pre><code>${escHtml(c.code)}</code></pre>`;
    case 'schema':
      return `<pre><code>${escHtml(prettyBody(c.definition))}</code></pre>`;
    case 'payload': {
      const method = String(c.method || '').toUpperCase();
      const type =
        typeof c.contentType === 'string' && c.contentType
          ? `<p>Content-Type: ${escHtml(c.contentType)}</p>`
          : '';
      return `<h3>Payload ${escHtml(method)}</h3>${type}<pre><code>${escHtml(prettyBody(c.body))}</code></pre>`;
    }
    case 'response':
      return `<h3>Example response (${Number(c.status)})</h3><pre><code>${escHtml(prettyBody(c.body))}</code></pre>`;
    case 'list': {
      const items = Array.isArray(c.items) ? c.items : [];
      const tag = c.style === 'number' ? 'ol' : 'ul';
      return `<${tag}>${items.map((it) => `<li>${escHtml(it)}</li>`).join('')}</${tag}>`;
    }
    case 'image': {
      const src = typeof c.src === 'string' ? c.src : '';
      const alt = typeof c.alt === 'string' ? c.alt : '';
      const size = IMG_SIZES.includes(c.size) ? c.size : 'full';
      const width = IMG_SIZE_PCT[size];
      const caption =
        typeof c.caption === 'string' && c.caption ? `<figcaption>${escHtml(c.caption)}</figcaption>` : '';
      return `<figure class="image-fig"><img src="${escHtml(src)}" alt="${escHtml(alt)}" style="max-width:${width}%" />${caption}</figure>`;
    }
    default:
      return '';
  }
}

// GET /docs/:pageId/export?format=markdown|html|word|json -> file download.
// Same read gate as GET /:pageId. Filename: doc-<slug>-<first8 of id>.<ext>.
// html/word share the app theme (see EXPORT_THEME_CSS): html backs the in-app
// "Print or save as PDF" flow, word is the same themed markup served as a
// Word-compatible .doc so the brand look survives into Office.
router.get('/:pageId/export', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    const format = String(req.query.format || '').toLowerCase();
    if (!['markdown', 'html', 'word', 'json'].includes(format)) {
      return res.status(400).json({ error: 'format must be markdown, html, word or json' });
    }
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const access = await workspaceAccessFor(req.user, page.workspace_id);
    if (!access.readable) return res.status(404).json({ error: 'Page not found' });

    const [summary, blockRows] = await Promise.all([
      serializePageSummary(page),
      query(
        `SELECT block_type, content FROM doc_blocks WHERE page_id = $1 ORDER BY position`,
        [pageId]
      ),
    ]);
    const blocks = blockRows.rows.map((b) => ({ type: b.block_type, content: b.content }));

    let body;
    let ext;
    let contentType;
    if (format === 'markdown') {
      const metaName = (summary.updatedBy && summary.updatedBy.name) || summary.createdBy.name || 'Unknown';
      const meta = `_Last updated ${new Date(page.updated_at).toISOString()} by ${metaName}_`;
      const rendered = blocks.map(blockToMarkdown).filter((s) => s !== '').join('\n\n');
      body = `# ${page.title}\n\n${meta}\n\n${rendered}\n`;
      ext = 'md';
      contentType = 'text/markdown; charset=utf-8';
    } else if (format === 'html' || format === 'word') {
      const metaName = (summary.updatedBy && summary.updatedBy.name) || summary.createdBy.name || 'Unknown';
      const meta = `Last updated ${new Date(page.updated_at).toISOString()} by ${escHtml(metaName)}`;
      const rendered = blocks.map(blockToHtml).join('\n');
      const contentHtml =
        `<h1>${escHtml(page.title)}</h1>\n<p class="meta">${meta}</p>\n` +
        `${rendered}`;
      body = buildDocumentShell(page.title, contentHtml, format === 'word');
      ext = format === 'word' ? 'doc' : 'html';
      contentType = format === 'word'
        ? 'application/msword; charset=utf-8'
        : 'text/html; charset=utf-8';
    } else {
      const mentionList = await sanitizePageMentions(pageId);
      const payload = {
        title: page.title,
        workspaceName: summary.workspaceName,
        updatedAt: new Date(page.updated_at).toISOString(),
        updatedBy: summary.updatedBy ? { name: summary.updatedBy.name } : null,
        blocks: blocks.map((b) => ({ type: b.type, content: b.content })),
        mentions: mentionList,
      };
      body = JSON.stringify(payload, null, 2);
      ext = 'json';
      contentType = 'application/json; charset=utf-8';
    }

    const slug = slugifyForFile(page.title);
    const filename = `doc-${slug}-${String(page.id).slice(0, 8)}.${ext}`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  } catch (err) {
    next(err);
  }
});

// Theme carried into exported documents (HTML print/PDF + Word .doc). Mirrors
// the app brand: dark canvas, panel cards, mint accent (#7cf29c) headings,
// Inter + JetBrains Mono, rounded code blocks. print-color-adjust keeps the
// background when the browser/PDF renderer strips it by default.
const EXPORT_THEME_CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: #0a0d0a;
  color: #e8efe9;
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.65;
  padding: 40px 20px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.doc-card {
  max-width: 880px;
  margin: 0 auto;
  background: #0f1511;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 16px;
  padding: 44px 52px;
}
.doc-head { margin-bottom: 6px; }
.doc-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7cf29c;
  margin-bottom: 14px;
}
.doc-brand .dot { width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(135deg, #a5f7bd 0%, #7cf29c 55%, #4ade80 120%); }
h1 { font-size: 30px; letter-spacing: -0.02em; margin: 0 0 6px; color: #f3faf4; }
p.meta { color: #8e9b94; font-size: 13px; margin: 0 0 24px; padding-bottom: 16px; border-bottom: 1px solid rgba(148, 163, 184, 0.14); }
h2 {
  color: #a5f7bd;
  font-size: 22px;
  letter-spacing: -0.02em;
  margin: 30px 0 10px;
  padding-left: 10px;
  border-left: 3px solid #7cf29c;
}
h3 { color: #7cf29c; font-size: 16px; margin: 20px 0 6px; }
p { margin: 10px 0; }
ul, ol { padding-left: 22px; }
li { margin: 4px 0; }
pre {
  background: #111814;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 10px;
  padding: 14px 16px;
  overflow: auto;
  margin: 10px 0;
}
code, pre {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
}
code { color: #a5f7bd; }
pre code { color: #c9d8cf; }
figure.image-fig { margin: 18px 0; }
figure.image-fig img {
  display: block;
  height: auto;
  max-width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 12px;
  background: #111814;
}
figure.image-fig figcaption { color: #8e9b94; font-size: 12px; text-align: center; margin-top: 6px; }
@media print {
  body { padding: 0; }
  .doc-card { box-shadow: none; border-radius: 0; }
}
`;

function buildDocumentShell(title, contentHtml, asWord) {
  const docType = asWord
    ? '<!DOCTYPE html>\n<html xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:o="urn:schemas-microsoft-com:office:office">'
    : '<!DOCTYPE html>\n<html lang="en">';
  const wordMeta = asWord
    ? '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->\n'
    : '';
  const pageCss = asWord
    ? '@page WordSection1 { size: 8.5in 11.0in; margin: 0.9in 0.8in; } div.WordSection1 { page: WordSection1; }\n'
    : '';
  return (
    `${docType}\n<head>\n<meta charset="utf-8">\n<title>${escHtml(title)}</title>\n` +
    `${wordMeta}<style>\n${pageCss}${EXPORT_THEME_CSS}\n</style>\n</head>\n` +
    `<body class="doc-body">\n<div class="WordSection1">\n` +
    `<div class="doc-card">\n` +
    `<div class="doc-brand"><span class="dot"></span>API Hub · Docs</div>\n` +
    `${contentHtml}\n` +
    `</div>\n</div>\n</body>\n</html>\n`
  );
}

function slugifyForFile(title) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'page';
}

// ---------------------------------------------------------------- Sharing

// Sanitized mention list (shared by the JSON export and the public snapshot):
// user refs -> {name}; api refs -> {name, method}. Never ids, emails or
// request internals.
async function sanitizePageMentions(pageId) {
  const { rows } = await query(
    `SELECT mention_type, ref_id FROM doc_mentions WHERE page_id = $1 ORDER BY created_at, id`,
    [pageId]
  );
  const mentions = [];
  for (const m of rows) {
    if (m.mention_type === 'user') {
      const { rows: us } = await query(`SELECT name FROM users WHERE id = $1`, [m.ref_id]);
      mentions.push({ type: 'user', ref: us[0] ? { name: us[0].name } : { name: null } });
    } else {
      const { rows: ap } = await query(`SELECT name, method FROM api_requests WHERE id = $1`, [m.ref_id]);
      mentions.push({ type: 'api', ref: ap[0] ? { name: ap[0].name, method: ap[0].method } : { name: null, method: null } });
    }
  }
  return mentions;
}

// POST /docs/:pageId/share -> 201 {share:{token,url}} (200 when a share
// already exists). Auth + canEdit + public-sharing plan gate.
router.post('/:pageId/share', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }
    const existing = await query(`SELECT id, token, created_at FROM doc_shares WHERE doc_id = $1`, [pageId]);
    if (existing.rows.length > 0) {
      const share = existing.rows[0];
      return res.json({ share: { token: share.token, url: `/s/doc/${share.token}` } });
    }
    const orgId = await orgOfWorkspace(page.workspace_id);
    const sharingGate = await checkPublicSharingGate({ userId: req.user.id, orgId });
    if (sharingGate) return res.status(403).json(sharingGate);
    const token = crypto.randomUUID();
    const created = await query(
      `INSERT INTO doc_shares (doc_id, token, created_by) VALUES ($1, $2, $3) RETURNING token`,
      [pageId, token, req.user.id]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'doc_page',
      entityId: pageId,
      action: 'share_doc',
      detail: { shareId: created.rows[0].token },
      ip: req.ip,
    });
    res.status(201).json({ share: { token, url: `/s/doc/${token}` } });
  } catch (err) {
    next(err);
  }
});

// DELETE /docs/:pageId/share -> 204. Auth + same edit gate as POST share.
router.delete('/:pageId/share', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }
    await query(`DELETE FROM doc_shares WHERE doc_id = $1`, [pageId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// GET /docs/public/:token -> 200 public safe snapshot (no auth). 404 unknown.
async function servePublicDocShare(req, res, next) {
  try {
    const token = String(req.params.token || '');
    if (!isUuid(token)) return res.status(404).json({ error: 'Share link not found' });
    const { rows } = await query(
      `SELECT s.token, s.created_at, s.doc_id,
              p.title, p.updated_at, p.updated_by,
              ub.name AS updated_by_name,
              w.name AS workspace_name
         FROM doc_shares s
         JOIN doc_pages p ON p.id = s.doc_id
         JOIN workspaces w ON w.id = p.workspace_id
         LEFT JOIN users ub ON ub.id = p.updated_by
        WHERE s.token = $1`,
      [token]
    );
    const share = rows[0];
    if (!share) return res.status(404).json({ error: 'Share link not found' });

    const [blockRows, mentions] = await Promise.all([
      query(
        `SELECT block_type, content FROM doc_blocks WHERE page_id = $1 ORDER BY position`,
        [share.doc_id]
      ),
      sanitizePageMentions(share.doc_id),
    ]);
    res.json({
      share: {
        token: share.token,
        createdAt: share.created_at,
        page: {
          title: share.title,
          updatedAt: share.updated_at,
          updatedBy: share.updated_by ? { name: share.updated_by_name } : null,
        },
        workspaceName: share.workspace_name,
        blocks: blockRows.rows.map((b) => ({ type: b.block_type, content: b.content })),
        mentions,
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /docs/:pageId -> 200 {page:{...(summary),canEdit},blocks:[Block],mentions:[Mention]}
// 404 for unknown pages or when the caller cannot read the page's workspace.
router.get('/:pageId', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const access = await workspaceAccessFor(req.user, page.workspace_id);
    if (!access.readable) return res.status(404).json({ error: 'Page not found' });

    const [summary, blocks, mentions] = await Promise.all([
      serializePageSummary(page),
      query(
        `SELECT id, position, block_type, content FROM doc_blocks
          WHERE page_id = $1 ORDER BY position`,
        [pageId]
      ),
      query(
        `SELECT id, page_id, mention_type, ref_id, created_by, created_at
           FROM doc_mentions WHERE page_id = $1 ORDER BY created_at, id`,
        [pageId]
      ),
    ]);
    const canEdit =
      page.created_by === req.user.id || roleAtLeast(access.role, 'EDITOR');
    const mentionList = [];
    for (const m of mentions.rows) mentionList.push(await serializeMention(m, req.user));
    res.json({
      page: { ...summary, canEdit },
      blocks: blocks.rows.map((b) => ({ id: b.id, position: b.position, type: b.block_type, content: b.content })),
      mentions: mentionList,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /docs/:pageId {title} -> 200 {page}. canEdit required.
router.put('/:pageId', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }
    const { title } = req.body || {};
    const cleanTitle = title === undefined || title === null ? '' : String(title).trim();
    if (!cleanTitle) return res.status(400).json({ error: 'title is required' });

    const updated = await query(
      `UPDATE doc_pages
          SET title = $1, updated_by = $2, updated_at = now()
        WHERE id = $3
        RETURNING id, workspace_id, project_id, title, created_by, updated_by, created_at, updated_at`,
      [cleanTitle, req.user.id, pageId]
    );
    const summary = await serializePageSummary(updated.rows[0]);
    res.json({ page: { ...summary, canEdit: true } });
  } catch (err) {
    next(err);
  }
});

// DELETE /docs/:pageId -> 204. Author OR workspace role >= ADMIN OR platform
// MANAGER/ADMIN.
router.delete('/:pageId', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canDeletePage(req.user, page))) {
      return res.status(403).json({ error: 'Workspace admin or author access required' });
    }
    await query(`DELETE FROM doc_pages WHERE id = $1`, [pageId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- Blocks

// PUT /docs/:pageId/blocks {blocks:[{id:string|null,type,content}]} -> 200
// {blocks:[Block]}. canEdit required. The page's block list is replaced: blocks
// with a child id are updated in place, blocks without id are inserted,
// positions are reassigned 0..n-1, and any existing child not referenced is
// removed. Provided ids that are not children of the page are pruned.
router.put('/:pageId/blocks', async (req, res, next) => {
  let client = null;
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }

    const incoming = (req.body || {}).blocks;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ error: 'blocks must be an array' });
    }

    // Validate every entry up front (a single malformed block rejects the call).
    const plan = [];
    for (const item of incoming) {
      if (item === null || typeof item !== 'object') {
        return res.status(400).json({ error: 'each block must be an object' });
      }
      const type = item.type;
      if (!BLOCK_TYPES.includes(type)) {
        return res.status(400).json({ error: `block_type must be one of ${BLOCK_TYPES.join(', ')}` });
      }
      const err = blockContentError(type, item.content);
      if (err) return res.status(400).json({ error: err });
      plan.push({ id: item.id && isUuid(item.id) ? item.id : null, type, content: item.content });
    }

    const { rows: existing } = await query(
      `SELECT id FROM doc_blocks WHERE page_id = $1`,
      [pageId]
    );
    const childIds = new Set(existing.map((b) => b.id));
    const usedChildIds = new Set();
    const kept = [];
    for (const item of plan) {
      if (item.id && childIds.has(item.id) && !usedChildIds.has(item.id)) {
        usedChildIds.add(item.id);
        kept.push({ op: 'update', id: item.id, type: item.type, content: item.content });
      } else if (item.id && childIds.has(item.id)) {
        // Duplicate reference to the same child block: pruned.
        continue;
      } else if (item.id) {
        // Reference to a block that is not a child of this page: pruned.
        continue;
      } else {
        kept.push({ op: 'insert', id: null, type: item.type, content: item.content });
      }
    }

    client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Move the retained children far out of the way first so the inserts
      // below can take low positions without tripping the (page_id, position)
      // unique constraint; the retained rows keep their ids for in-place
      // update. The +1e9 offset is unique-preserving because the source
      // positions were already unique.
      const keptChildIds = [...usedChildIds];
      if (keptChildIds.length > 0) {
        await client.query(
          `UPDATE doc_blocks SET position = position + 1000000000
            WHERE page_id = $1 AND id = ANY($2::uuid[])`,
          [pageId, keptChildIds]
        );
        await client.query(`DELETE FROM doc_blocks WHERE page_id = $1 AND id <> ALL($2::uuid[])`, [
          pageId,
          keptChildIds,
        ]);
      } else {
        await client.query(`DELETE FROM doc_blocks WHERE page_id = $1`, [pageId]);
      }
      let position = 0;
      for (const item of kept) {
        const content = JSON.stringify(item.content);
        if (item.op === 'update') {
          await client.query(
            `UPDATE doc_blocks SET position = $1, block_type = $2, content = $3
              WHERE id = $4 AND page_id = $5`,
            [position, item.type, content, item.id, pageId]
          );
        } else {
          await client.query(
            `INSERT INTO doc_blocks (page_id, position, block_type, content)
             VALUES ($1, $2, $3, $4)`,
            [pageId, position, item.type, content]
          );
        }
        position += 1;
      }
      await client.query(
        `UPDATE doc_pages SET updated_by = $1, updated_at = now() WHERE id = $2`,
        [req.user.id, pageId]
      );
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
      client = null;
    }

    const { rows } = await query(
      `SELECT id, position, block_type, content FROM doc_blocks
        WHERE page_id = $1 ORDER BY position`,
      [pageId]
    );
    res.json({ blocks: rows.map((b) => ({ id: b.id, position: b.position, type: b.block_type, content: b.content })) });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      client.release();
    }
    next(err);
  }
});

// --------------------------------------------------------------- Mentions

// POST /docs/:pageId/mentions {type:'user'|'api', refId} -> 201 {mention}.
// canEdit required. user: refId must hold a workspace_members row in the page's
// workspace; api: refId must be an api_requests row whose collection belongs to
// the page's workspace. Existing (page,type,refId) -> 409.
router.post('/:pageId/mentions', async (req, res, next) => {
  try {
    const { pageId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }

    const { type, refId } = req.body || {};
    if (!['user', 'api'].includes(type)) {
      return res.status(400).json({ error: 'type must be user or api' });
    }
    if (!refId) return res.status(400).json({ error: 'refId is required' });

    const dup = await query(
      `SELECT id FROM doc_mentions WHERE page_id = $1 AND mention_type = $2 AND ref_id = $3`,
      [pageId, type, refId]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'This mention already exists on the page' });
    }

    if (type === 'user') {
      if (!isUuid(refId)) {
        return res.status(404).json({ error: 'User is not a member of this workspace' });
      }
      const member = await query(
        `SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
        [page.workspace_id, refId]
      );
      if (member.rows.length === 0) {
        return res.status(404).json({ error: 'User is not a member of this workspace' });
      }
    } else {
      if (!isUuid(refId)) {
        return res.status(404).json({ error: 'API request not found in this workspace' });
      }
      const api = await query(
        `SELECT ar.id FROM api_requests ar
           JOIN collections c ON c.id = ar.collection_id
           JOIN projects p ON p.id = c.project_id
          WHERE ar.id = $1 AND p.workspace_id = $2`,
        [refId, page.workspace_id]
      );
      if (api.rows.length === 0) {
        return res.status(404).json({ error: 'API request not found in this workspace' });
      }
    }

    const created = await query(
      `INSERT INTO doc_mentions (page_id, mention_type, ref_id, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, page_id, mention_type, ref_id, created_by, created_at`,
      [pageId, type, refId, req.user.id]
    );
    await query(`UPDATE doc_pages SET updated_by = $1, updated_at = now() WHERE id = $2`, [
      req.user.id,
      pageId,
    ]);
    const mention = await serializeMention(created.rows[0], req.user);
    res.status(201).json({ mention });
  } catch (err) {
    next(err);
  }
});

// DELETE /docs/:pageId/mentions/:mentionId -> 204. canEdit required; 404 unknown.
router.delete('/:pageId/mentions/:mentionId', async (req, res, next) => {
  try {
    const { pageId, mentionId } = req.params;
    if (!isUuid(pageId)) return res.status(404).json({ error: 'Page not found' });
    const page = await pageRow(pageId);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    if (!(await canEditPage(req.user, page))) {
      return res.status(403).json({ error: 'Editor or admin access required' });
    }
    if (!isUuid(mentionId)) return res.status(404).json({ error: 'Mention not found' });
    const del = await query(
      `DELETE FROM doc_mentions WHERE id = $1 AND page_id = $2`,
      [mentionId, pageId]
    );
    if (del.rowCount === 0) return res.status(404).json({ error: 'Mention not found' });
    await query(`UPDATE doc_pages SET updated_by = $1, updated_at = now() WHERE id = $2`, [
      req.user.id,
      pageId,
    ]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ================================================= Workspace access requests

// Request: {id,workspaceId,workspaceName,requesterId,requester:{id,name,email},
// reason,status,requestedAt,reviewedBy:null|{id,name},reviewedAt}
async function serializeAccessRequest(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    requesterId: row.user_id,
    requester: { id: row.user_id, name: row.requester_name, email: row.requester_email },
    reason: row.reason ?? null,
    status: row.status,
    requestedAt: row.requested_at,
    reviewedBy: row.reviewed_by
      ? { id: row.reviewed_by, name: row.reviewer_name }
      : null,
    reviewedAt: row.reviewed_at ?? null,
  };
}

async function loadAccessRequest(id) {
  const { rows } = await query(
    `SELECT war.*, w.name AS workspace_name,
            ru.name AS requester_name, ru.email AS requester_email,
            rb.name AS reviewer_name
       FROM workspace_access_requests war
       JOIN workspaces w ON w.id = war.workspace_id
       JOIN users ru ON ru.id = war.user_id
       LEFT JOIN users rb ON rb.id = war.reviewed_by
      WHERE war.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// POST /workspace-access-requests {workspaceId, reason?} -> 201 {request}.
// Any authenticated user; 409 if already a member or a PENDING request exists;
// 404 if the workspace does not exist.
accessRequestRouter.post('/', async (req, res, next) => {
  try {
    const { workspaceId, reason } = req.body || {};
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
    const ws = await query(`SELECT id FROM workspaces WHERE id = $1`, [workspaceId]);
    if (ws.rows.length === 0) return res.status(404).json({ error: 'Workspace not found' });

    const existingRole = await getWorkspaceRole(req.user.id, workspaceId);
    if (existingRole) {
      return res.status(409).json({ error: 'You already have access to this workspace' });
    }
    const pending = await query(
      `SELECT id FROM workspace_access_requests
        WHERE workspace_id = $1 AND user_id = $2 AND status = 'PENDING'`,
      [workspaceId, req.user.id]
    );
    if (pending.rows.length > 0) {
      return res.status(409).json({ error: 'You already have a pending request for this workspace' });
    }

    const created = await query(
      `INSERT INTO workspace_access_requests (workspace_id, user_id, reason)
       VALUES ($1, $2, $3) RETURNING id`,
      [workspaceId, req.user.id, reason ? String(reason) : null]
    );
    await logAudit({
      actorId: req.user.id,
      entityType: 'workspace_access_request',
      entityId: created.rows[0].id,
      action: 'request_access',
      detail: { workspaceId },
      ip: req.ip,
    });
    const row = await loadAccessRequest(created.rows[0].id);
    res.status(201).json({ request: await serializeAccessRequest(row) });
  } catch (err) {
    next(err);
  }
});

// GET /workspace-access-requests?workspaceId=<uuid>[&mine=1][&status=PENDING]
// mine=1: the caller's own rows (with workspaceName). Otherwise the caller must
// be a workspace admin (or platform MANAGER/ADMIN) of the given workspace.
accessRequestRouter.get('/', async (req, res, next) => {
  try {
    const { workspaceId, mine, status } = req.query;
    const mineMode = mine === '1' || mine === 'true';
    if (status !== undefined && status !== '' && !['PENDING', 'APPROVED', 'DENIED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'status must be PENDING, APPROVED, DENIED or CANCELLED' });
    }

    if (mineMode) {
      const { rows } = await query(
        `SELECT war.*, w.name AS workspace_name,
                ru.name AS requester_name, ru.email AS requester_email,
                rb.name AS reviewer_name
           FROM workspace_access_requests war
           JOIN workspaces w ON w.id = war.workspace_id
           JOIN users ru ON ru.id = war.user_id
           LEFT JOIN users rb ON rb.id = war.reviewed_by
          WHERE war.user_id = $1
            AND ($2::uuid IS NULL OR war.workspace_id = $2)
            AND ($3::text IS NULL OR war.status = $3)
          ORDER BY war.requested_at DESC`,
        [req.user.id, (workspaceId && isUuid(workspaceId) && workspaceId) || null, status || null]
      );
      const requests = [];
      for (const r of rows) requests.push(await serializeAccessRequest(r));
      return res.json({ requests });
    }

    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!isUuid(workspaceId)) return res.status(400).json({ error: 'workspaceId must be a valid uuid' });
    const access = await workspaceAccessFor(req.user, workspaceId);
    if (!roleAtLeast(access.role, 'ADMIN')) {
      return res.status(403).json({ error: 'Workspace admin access required' });
    }
    const { rows } = await query(
      `SELECT war.*, w.name AS workspace_name,
              ru.name AS requester_name, ru.email AS requester_email,
              rb.name AS reviewer_name
         FROM workspace_access_requests war
         JOIN workspaces w ON w.id = war.workspace_id
         JOIN users ru ON ru.id = war.user_id
         LEFT JOIN users rb ON rb.id = war.reviewed_by
        WHERE war.workspace_id = $1
          AND ($2::text IS NULL OR war.status = $2)
        ORDER BY war.requested_at DESC`,
      [workspaceId, status || null]
    );
    const requests = [];
    for (const r of rows) requests.push(await serializeAccessRequest(r));
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// POST /workspace-access-requests/:id/review {approve:boolean} -> 200
// {ok:true,status}. Reviewer gate = workspace role >= ADMIN (or platform
// MANAGER/ADMIN). 404 unknown; 409 not PENDING. Approve grants a VIEWER
// membership; both outcomes notify the requester and are audited.
accessRequestRouter.post('/:id/review', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { approve } = req.body || {};
    if (typeof approve !== 'boolean') {
      return res.status(400).json({ error: 'approve must be a boolean' });
    }
    if (!isUuid(id)) return res.status(404).json({ error: 'Access request not found' });
    const request = await loadAccessRequest(id);
    if (!request) return res.status(404).json({ error: 'Access request not found' });
    const access = await workspaceAccessFor(req.user, request.workspace_id);
    if (!roleAtLeast(access.role, 'ADMIN')) {
      return res.status(403).json({ error: 'Workspace admin access required' });
    }
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: 'This request has already been reviewed' });
    }

    const status = approve ? 'APPROVED' : 'DENIED';
    await query(
      `UPDATE workspace_access_requests
          SET status = $1, reviewed_by = $2, reviewed_at = now()
        WHERE id = $3`,
      [status, req.user.id, id]
    );
    if (approve) {
      await query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, granted_by)
         VALUES ($1, $2, 'VIEWER', $3)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [request.workspace_id, request.user_id, req.user.id]
      );
      await notifyUser({
        userId: request.user_id,
        title: 'Workspace access granted',
        body: `Your request to join "${request.workspace_name}" was approved.`,
        kind: 'success',
      });
      await logAudit({
        actorId: req.user.id,
        entityType: 'workspace_access_request',
        entityId: id,
        action: 'approve',
        detail: { workspaceId: request.workspace_id, userId: request.user_id },
        ip: req.ip,
      });
    } else {
      await notifyUser({
        userId: request.user_id,
        title: 'Workspace access denied',
        body: `Your request to join "${request.workspace_name}" was declined.`,
        kind: 'info',
      });
      await logAudit({
        actorId: req.user.id,
        entityType: 'workspace_access_request',
        entityId: id,
        action: 'deny',
        detail: { workspaceId: request.workspace_id, userId: request.user_id },
        ip: req.ip,
      });
    }
    res.json({ ok: true, status });
  } catch (err) {
    next(err);
  }
});

// POST /workspace-access-requests/:id/cancel -> 200 {ok:true}. Creator only
// while PENDING (404 otherwise / 409 if not PENDING).
accessRequestRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Access request not found' });
    const request = await loadAccessRequest(id);
    if (!request || request.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Access request not found' });
    }
    if (request.status !== 'PENDING') {
      return res.status(409).json({ error: 'Only pending requests can be cancelled' });
    }
    await query(`UPDATE workspace_access_requests SET status = 'CANCELLED' WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
// Pre-auth public share viewer (mounted by the coordinator in server.js ahead
// of the authenticated /api routers, mirroring the /api/webhooks pattern).
module.exports.publicRouter = publicDocRouter;
