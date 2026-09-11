// The tutorial script. Each segment is recorded as its own video and each scene
// has a narration line (synthesized to audio) plus the Playwright actions that
// play out while that line is spoken.
//
// The tour follows three teammates by access level and visits every rail:
//   Editor  — Request Studio, environments, mock scenarios, contracts, monitors,
//             automations, docs, collaboration, history, copilot, teams, limits.
//   Manager — the Manage console (overview, projects, teams, access requests,
//             audit log, run history, settings).
//   Admin   — admin console (users, invite, access), platform settings, API
//             tokens and the inbox.

import { readFileSync } from 'node:fs';

// Seeded resource ids (written by fixtures.mjs) so scenes can deep-link to real
// content, e.g. a docs page or a collection's collaboration view.
let FIXTURES = {};
try {
  FIXTURES = JSON.parse(readFileSync(new URL('./.work/fixtures.json', import.meta.url), 'utf8'));
} catch {
  FIXTURES = {};
}
const editorCollection = FIXTURES.editor?.collectionId || '';
const editorProject = FIXTURES.editor?.projectId || '';
const editorDocPage = FIXTURES.editor?.docsPageId || '';

export const LOGIN = {
  admin: { email: 'boss1785867669@test.io', password: 'bosspass123', label: 'Sam, administrator' },
  manager: { email: 'pm1785867669@test.io', password: 'pmpass1234', label: 'Priya, manager' },
  editor: { email: 'dev1785867669@test.io', password: 'devpass123', label: 'Dev, editor' },
};

const COLL_LINE = 'collection-Payments API';

async function signIn(page, h, account) {
  await h.goto('/login');
  await h.type(page.getByTestId('login-email'), account.email);
  await h.type(page.getByTestId('login-password'), account.password);
  await h.focus(page.getByTestId('login-submit'), 250);
  await h.tap(page.getByTestId('login-submit'), 250);
  await page.waitForSelector(`[data-testid="${COLL_LINE}"]`, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(450);
  h.narrateNow();
}

// Switch to another view via the icon rail and wait for its page.
async function rail(page, h, testid, ready) {
  await h.focus(page.getByTestId(testid), 450);
  await h.tap(page.getByTestId(testid), 250);
  if (ready) await page.waitForSelector(ready, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  h.narrateNow();
}

// Click a tab inside a view and wait for its section.
async function tab(page, h, testid, ready) {
  await h.focus(page.getByTestId(testid), 400);
  await h.tap(page.getByTestId(testid), 200);
  if (ready) await page.waitForSelector(ready, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(450);
  h.narrateNow();
}

export const segments = [
  // ------------------------------------------------------------------ INTRO
  {
    id: 'intro',
    title: 'Introduction',
    role: null,
    scenes: [
      {
        id: 'welcome',
        narration:
          "Welcome to MockShift, the workspace where teams design, mock, test and document APIs together. In just a few minutes, I'll show you every part of the product.",
        run: async (page, h) => {
          await h.goto('/login');
          h.narrateNow();
          await h.focus(page.getByTestId('login-email'), 900);
        },
      },
    ],
  },

  // ----------------------------------------------------------------- EDITOR
  {
    id: 'editor',
    title: 'Editor access',
    role: 'EDITOR',
    scenes: [
      {
        id: 'signin',
        narration:
          "I'm signing in as Dev, an editor on the team. Everyone uses the same login — what changes is what each person is allowed to do.",
        run: async (page, h) => {
          await signIn(page, h, LOGIN.editor);
        },
      },
      {
        id: 'request-editor',
        narration:
          'Collections hold the requests a team shares. I open List payments — the method, URL, headers, body and tests are all saved with it.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('collection-Payments API'), 450);
          const req = page.getByTestId('sidebar-request-List payments');
          await h.focus(req, 500);
          await h.tap(req, 250);
          await page.waitForSelector('[data-testid="send-button"]', { timeout: 15000 }).catch(() => {});
          await h.focus(page.getByTestId('url-input'), 700);
          h.narrateNow();
        },
      },
      {
        id: 'send',
        narration:
          'One click sends the real request. Status, time and size appear instantly, with the JSON body formatted and ready to inspect.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('send-button'), 450);
          await h.tap(page.getByTestId('send-button'), 300);
          await page.waitForSelector('[data-testid="response-pane"]', { timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(500);
          h.narrateNow();
        },
      },
      {
        id: 'response',
        narration:
          'Switch to Headers to see exactly what came back, or Preview and download when the response is a page, a document or an image.',
        run: async (page, h) => {
          const headers = page.getByRole('button', { name: 'Headers' }).first();
          await h.focus(headers, 500);
          await h.tap(headers, 250);
          await page.waitForTimeout(400);
          await h.focus(page.getByTestId('response-pane'), 900);
          h.narrateNow();
        },
      },
      {
        id: 'environments',
        narration:
          'Environments keep secrets and base URLs out of the request itself. Staging is active, with a reusable API token the whole team shares.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('environments-open'), 450);
          await h.tap(page.getByTestId('environments-open'), 250);
          await page.waitForSelector('[data-testid="env-Staging"]', { timeout: 15000 }).catch(() => {});
          await h.focus(page.getByTestId('env-Staging'), 900);
          const vars = page.getByTestId('var-key');
          if (await vars.count()) await h.point(vars.first(), 600);
          h.narrateNow();
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(300);
        },
      },
      {
        id: 'mock',
        narration:
          "When an API doesn't exist yet, MockShift serves it. Routes define responses, and named scenarios simulate alternate behaviour, like an outage returning a 503.",
        run: async (page, h) => {
          await rail(page, h, 'rail-mock-scenarios', '[data-testid="mock-scenarios-panel"]');
          await h.focus(page.getByTestId('mock-scenarios-server-name'), 900);
          const scenario = page.getByText('maintenance', { exact: true }).first();
          if (await scenario.count()) await h.focus(scenario, 1100);
        },
      },
      {
        id: 'contracts',
        narration:
          'Contracts turn an OpenAPI spec into a live checklist. Import it once and MockShift tracks every operation, and flags breaking changes between versions.',
        run: async (page, h) => {
          await rail(page, h, 'rail-contracts', '[data-testid="contracts-view"]');
          const spec = page.getByText('Payments API', { exact: false }).first();
          if (await spec.count()) await h.focus(spec, 900);
        },
      },
      {
        id: 'monitors',
        narration:
          'Monitors run saved requests on a schedule and track uptime, so you find out the moment an endpoint goes down.',
        run: async (page, h) => {
          await rail(page, h, 'rail-monitors', '[data-testid="monitors-page"]');
          await h.focus(page.getByTestId('monitors-page'), 900);
        },
      },
      {
        id: 'automations',
        narration:
          'Automations chain requests into workflows and fire them on a schedule, a webhook, or a failed run — no glue code required.',
        run: async (page, h) => {
          await rail(page, h, 'rail-automations', '[data-testid="automations-page"]');
          await h.focus(page.getByTestId('automations-page'), 900);
        },
      },
      {
        id: 'docs',
        narration:
          'Docs turn team knowledge into living pages, with API examples, payloads and schemas you can keep in sync with the work.',
        run: async (page, h) => {
          await rail(page, h, 'rail-docs', '[data-testid="docs-home"]');
          if (editorDocPage) {
            await h.goto(`/docs?p=${editorDocPage}`);
            await page.waitForSelector('[data-testid="docs-page"]', { timeout: 15000 }).catch(() => {});
            await h.focus(page.getByTestId('docs-page-title'), 900);
            h.narrateNow();
          } else {
            await h.focus(page.getByTestId('docs-list'), 800);
          }
        },
      },
      {
        id: 'collab',
        narration:
          'Collaboration adds comments, reviews and version snapshots, so every change gets a second pair of eyes before it ships.',
        run: async (page, h) => {
          await rail(page, h, 'rail-collab', '[data-testid="collab-view"]');
          if (editorCollection) {
            await h.goto(`/collab?targetType=collection&targetId=${editorCollection}&projectId=${editorProject}`);
            await page.waitForSelector('[data-testid="collab-panel"]', { timeout: 15000 }).catch(() => {});
            await h.focus(page.getByTestId('collab-panel'), 900);
            h.narrateNow();
          } else {
            await h.focus(page.getByTestId('collab-view'), 800);
          }
        },
      },
      {
        id: 'history',
        narration:
          'Every run is saved. History keeps the request, the response and the assertion results, so you can see exactly what happened.',
        run: async (page, h) => {
          await rail(page, h, 'rail-history', '[data-testid="history-page"]');
          await h.focus(page.getByTestId('history-list'), 900);
        },
      },
      {
        id: 'copilot',
        narration:
          'The AI copilot helps write assertions and explain a failed run. It uses your own model key, never a shared one.',
        run: async (page, h) => {
          await rail(page, h, 'rail-copilot', '[data-testid="copilot-panel"]');
          await h.focus(page.getByTestId('copilot-panel'), 900);
        },
      },
      {
        id: 'teams',
        narration:
          'Teams let you group people once, then share whole workspaces with the group instead of one colleague at a time.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('rail-teams'), 400);
          await h.tap(page.getByTestId('rail-teams'), 250);
          await page.waitForTimeout(900);
          h.narrateNow();
        },
      },
      {
        id: 'limits',
        narration:
          "That's editor access. What's missing is deliberate: no Manage rail and no admin console. People and settings stay with managers and administrators.",
        run: async (page, h) => {
          await rail(page, h, 'rail-apis', `[data-testid="${COLL_LINE}"]`);
          await h.focus(page.getByTestId('user-avatar'), 700);
        },
      },
    ],
  },

  // ---------------------------------------------------------------- MANAGER
  {
    id: 'manager',
    title: 'Manager access',
    role: 'MANAGER',
    scenes: [
      {
        id: 'signin',
        narration: "Now I'm Priya, a project manager. Managers unlock the Manage rail and a workspace-wide view.",
        run: async (page, h) => {
          await signIn(page, h, LOGIN.manager);
        },
      },
      {
        id: 'overview',
        narration:
          'The overview summarises projects, users and recent activity across everything I manage, at a glance.',
        run: async (page, h) => {
          await rail(page, h, 'rail-manage', '[data-testid="manage-page"]');
          await h.focus(page.getByTestId('overview-grid'), 900);
        },
      },
      {
        id: 'projects',
        narration: 'Projects shows who manages each project and who belongs to it.',
        run: async (page, h) => {
          await tab(page, h, 'manage-tab-projects', '[data-testid="manage-projects-section"]');
          await h.focus(page.getByTestId('manage-projects-section'), 900);
        },
      },
      {
        id: 'teams',
        narration: 'Teams shows the groups in play across the organisation, and their members.',
        run: async (page, h) => {
          await tab(page, h, 'manage-tab-teams', '[data-testid="manage-teams-section"]');
          await h.focus(page.getByTestId('manage-teams-section'), 900);
        },
      },
      {
        id: 'requests',
        narration: 'Access requests land here for approval, so onboarding never has to happen over email.',
        run: async (page, h) => {
          await tab(page, h, 'manage-tab-requests', '[data-testid="access-requests-section"]');
          await h.focus(page.getByTestId('access-requests-section'), 900);
        },
      },
      {
        id: 'audit',
        narration: 'The audit log records who changed what, and when — ready whenever you need it.',
        run: async (page, h) => {
          await tab(page, h, 'manage-tab-audit', '[data-testid="manage-audit-section"]');
          await h.focus(page.getByTestId('manage-audit-section'), 900);
        },
      },
      {
        id: 'history',
        narration: 'Run history rolls up every request across the team, with status and timing.',
        run: async (page, h) => {
          await tab(page, h, 'manage-tab-history', '[data-testid="manage-history-section"]');
          await h.focus(page.getByTestId('manage-history-section'), 900);
        },
      },
      {
        id: 'settings',
        narration: 'Settings control things like how long run history is kept, workspace by workspace.',
        run: async (page, h) => {
          await tab(page, h, 'manage-tab-settings', '[data-testid="manage-settings-section"]');
          await h.focus(page.getByTestId('manage-settings-section'), 900);
        },
      },
      {
        id: 'limits',
        narration: "Managers run the workspace. What they don't get is the platform-wide admin console.",
        run: async (page, h) => {
          await h.focus(page.getByTestId('rail-manage'), 500);
          await h.focus(page.getByTestId('user-avatar'), 700);
        },
      },
    ],
  },

  // ------------------------------------------------------------------ ADMIN
  {
    id: 'admin',
    title: 'Administrator access',
    role: 'ADMIN',
    scenes: [
      {
        id: 'signin',
        narration: 'Finally, Sam, the administrator, with the highest level of access in MockShift.',
        run: async (page, h) => {
          await signIn(page, h, LOGIN.admin);
        },
      },
      {
        id: 'users',
        narration:
          'The admin console lists every user, their role and the projects they belong to. Roles and access are changed right here.',
        run: async (page, h) => {
          await rail(page, h, 'rail-admin', '[data-testid="admin-page"]');
          await h.focus(page.getByTestId('admin-table'), 900);
        },
      },
      {
        id: 'create-user',
        narration: 'Inviting someone is one short form — name, email, role and a starting password.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('create-user-open'), 450);
          await h.tap(page.getByTestId('create-user-open'), 250);
          await page.waitForSelector('[data-testid="create-user-modal"]', { timeout: 12000 }).catch(() => {});
          await h.focus(page.getByTestId('create-user-role'), 900);
          h.narrateNow();
          await h.tap(page.getByTestId('create-user-cancel'), 250);
          await page.waitForSelector('[data-testid="create-user-modal"]', { state: 'detached', timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(300);
        },
      },
      {
        id: 'access',
        narration: 'The access tab shows who can reach what across the platform, and lets administrators grant or revoke it.',
        run: async (page, h) => {
          await tab(page, h, 'admin-tab-access', '[data-testid="admin-access-section"]');
          await h.focus(page.getByTestId('admin-access-section'), 900);
        },
      },
      {
        id: 'platform-settings',
        narration: 'Administrators also see a platform-wide view, and set run-history retention for every workspace.',
        run: async (page, h) => {
          await rail(page, h, 'rail-manage', '[data-testid="manage-page"]');
          await tab(page, h, 'manage-tab-settings', '[data-testid="manage-settings-section"]');
        },
      },
      {
        id: 'tokens',
        narration: 'Personal API tokens let scripts and CI authenticate without a browser session — scoped and revocable.',
        run: async (page, h) => {
          await h.goto('/settings/api-tokens');
          await page.waitForSelector('[data-testid="api-tokens-page"]', { timeout: 15000 }).catch(() => {});
          await h.focus(page.getByTestId('apitoken-list'), 900);
          h.narrateNow();
        },
      },
      {
        id: 'inbox',
        narration:
          'The inbox carries items teammates send you — requests, folders, even entire workspaces — to accept into your own account.',
        run: async (page, h) => {
          await h.goto('/inbox');
          await page.waitForSelector('[data-testid="inbox-page"]', { timeout: 15000 }).catch(() => {});
          await h.focus(page.getByTestId('inbox-page'), 900);
          h.narrateNow();
        },
      },
      {
        id: 'limits',
        narration: 'That is the full range of administrator access — the top of the pyramid.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('user-avatar'), 700);
        },
      },
    ],
  },

  // ------------------------------------------------------------------ OUTRO
  {
    id: 'outro',
    title: 'Recap',
    role: null,
    scenes: [
      {
        id: 'recap',
        narration:
          'So that is MockShift: design, mock, test, document and govern APIs in one place. Editors build. Managers run the workspace. Administrators govern the platform. Thanks for watching.',
        run: async (page, h) => {
          await h.goto('/');
          h.narrateNow();
          await page.waitForTimeout(700);
        },
      },
    ],
  },
];
