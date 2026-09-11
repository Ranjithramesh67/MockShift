// The tutorial script. Each segment is recorded as its own video and each
// scene has a narration line (synthesized to audio) plus the Playwright actions
// that play out while that line is spoken.

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
  h.narrateNow();
  await h.focus(page.getByTestId('login-submit'), 500);
  await h.tap(page.getByTestId('login-submit'));
  await page.waitForSelector(`[data-testid="${COLL_LINE}"]`, { timeout: 45000 });
  await page.waitForTimeout(700);
}

async function openRail(page, h, testid, readySelector) {
  await h.focus(page.getByTestId(testid), 700);
  await h.tap(page.getByTestId(testid));
  if (readySelector) await page.waitForSelector(readySelector, { timeout: 20000 });
  await page.waitForTimeout(900);
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
          'Welcome to MockShift, the collaborative workspace where teams design, mock, test and document their APIs. In this tour we follow three teammates to see what each access level can do.',
        run: async (page, h) => {
          await h.goto('/login');
          h.narrateNow();
          await h.caption('MockShift — an API workspace for the whole team');
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
          'This is Dev, an editor on the payments team. Everyone signs in the same way. What changes between teammates is what they are allowed to do.',
        run: async (page, h) => {
          await signIn(page, h, LOGIN.editor);
          await h.caption('Signed in as Dev — Editor');
        },
      },
      {
        id: 'open-request',
        narration:
          'Collections hold the team requests. Dev opens List payments and the request editor loads the method, URL and saved settings.',
        run: async (page, h) => {
          const req = page.getByTestId('sidebar-request-List payments');
          await h.focus(req, 900);
          await h.tap(req);
          await page.waitForSelector('[data-testid="send-button"]', { timeout: 15000 });
          await h.focus(page.getByTestId('url-input'), 1100);
        },
      },
      {
        id: 'send',
        narration:
          'Press Send and MockShift executes the request. The response pane reports the status, the time it took and the size, then the formatted JSON body.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('send-button'), 700);
          await h.tap(page.getByTestId('send-button'));
          await page.waitForSelector('[data-testid="response-pane"]', { timeout: 20000 });
          await page.waitForTimeout(900);
          await h.focus(page.getByTestId('response-pane'), 1600);
        },
      },
      {
        id: 'response-detail',
        narration:
          'Switch to Headers to inspect exactly what the server returned, and Preview or Download when the response is a document, a page or an image.',
        run: async (page, h) => {
          const headers = page.getByRole('button', { name: 'Headers' });
          if (await headers.count()) {
            await h.focus(headers, 700);
            await h.tap(headers);
          }
          await page.waitForTimeout(1400);
          const body = page.getByRole('button', { name: 'Body', exact: true });
          if (await body.count()) await h.tap(body);
          await h.focus(page.getByTestId('response-pane'), 900);
        },
      },
      {
        id: 'environments',
        narration:
          'Environments keep values such as base URLs and secrets out of the request itself. Here Staging is active, with a base URL and a secret API token the team can reuse.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('environments-open'), 700);
          await h.tap(page.getByTestId('environments-open'));
          await page.waitForSelector('[data-testid="env-Staging"]', { timeout: 15000 });
          await page.waitForTimeout(600);
          await h.focus(page.getByTestId('env-Staging'), 1300);
          const vars = page.getByTestId('var-key');
          if (await vars.count()) await h.point(vars.first(), 900);
          await page.keyboard.press('Escape').catch(() => {});
        },
      },
      {
        id: 'mock-server',
        narration:
          'A mock server can stand in for a real API before it exists. Routes define responses, and named scenarios simulate alternate behaviour, like an outage returning a 503.',
        run: async (page, h) => {
          await openRail(page, h, 'rail-mock-scenarios', '[data-testid="mock-scenarios-panel"]');
          await h.focus(page.getByTestId('mock-scenarios-server-name'), 1100);
          await h.focus(page.getByTestId('mock-scenarios-route-method').first(), 1100);
          const scenario = page.getByText('maintenance', { exact: true }).first();
          if (await scenario.count()) await h.focus(scenario, 1300);
        },
      },
      {
        id: 'limits',
        narration:
          'Notice what an editor does not get. There is no Manage rail and no Admin console. Dev can build, run and document APIs, while people and settings stay with managers and administrators.',
        run: async (page, h) => {
          await openRail(page, h, 'rail-apis', `[data-testid="${COLL_LINE}"]`);
          await h.focus(page.getByTestId('user-avatar'), 500);
          await h.caption('Editor: no Manage, no Admin console');
          await page.waitForTimeout(600);
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
        narration:
          'Now we sign in as Priya, a manager. The workspace looks familiar, but this account unlocks team coordination.',
        run: async (page, h) => {
          await signIn(page, h, LOGIN.manager);
          await h.caption('Signed in as Priya — Manager');
        },
      },
      {
        id: 'manage-overview',
        narration:
          'The Manage rail is now available. Its overview summarises projects, users and recent activity across the workspace.',
        run: async (page, h) => {
          await openRail(page, h, 'rail-manage', '[data-testid="manage-page"]');
          await h.focus(page.getByTestId('manage-tabs'), 1400);
        },
      },
      {
        id: 'manage-projects',
        narration:
          'Projects shows each team space, who can reach it and how many managers and members it has. Priya can open a project to adjust its people.',
        run: async (page, h) => {
          const tab = page.getByTestId('manage-tab-projects');
          await h.focus(tab, 600);
          await h.tap(tab);
          await page.waitForSelector('[data-testid="manage-project-Default Project"]', { timeout: 15000 }).catch(() => {});
          await h.focus(page.getByTestId('manage-project-Default Project'), 1500);
        },
      },
      {
        id: 'manage-teams',
        narration:
          'Managers also handle teams, audit history and the settings that keep a workspace healthy, such as how long run history is kept.',
        run: async (page, h) => {
          const tab = page.getByTestId('manage-tab-teams');
          await h.focus(tab, 600);
          await h.tap(tab);
          await page.waitForTimeout(1600);
        },
      },
      {
        id: 'run-history',
        narration:
          'Run history records every execution with its request snapshot and result, so the team can trace what changed and when.',
        run: async (page, h) => {
          await openRail(page, h, 'rail-history', '[data-testid="history-page"]');
          await h.focus(page.getByTestId('history-page'), 1500);
        },
      },
      {
        id: 'limits',
        narration:
          'A manager runs projects and people, but the Admin console, organisation-wide users and retention policy remain with administrators.',
        run: async (page, h) => {
          await openRail(page, h, 'rail-apis', `[data-testid="${COLL_LINE}"]`);
          await h.focus(page.getByTestId('user-avatar'), 500);
          await h.caption('Manager: Manage yes, Admin console no');
          await page.waitForTimeout(600);
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
        narration:
          'Finally, the administrator. Sam can reach everything, including the Admin console at the bottom of the rail.',
        run: async (page, h) => {
          await signIn(page, h, LOGIN.admin);
          await h.caption('Signed in as Sam — Administrator');
        },
      },
      {
        id: 'admin-users',
        narration:
          'The Admin console lists every user, their role and the projects they belong to. Administrators can change roles or disable an account from here.',
        run: async (page, h) => {
          await openRail(page, h, 'rail-admin', '[data-testid="admin-page"]');
          await h.focus(page.getByTestId('admin-table'), 1500);
        },
      },
      {
        id: 'create-user',
        narration:
          'New teammates are added straight from the console. The administrator chooses a name, an email, a role and a password, then confirms.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('create-user-open'), 700);
          await h.tap(page.getByTestId('create-user-open'));
          await page.waitForSelector('[data-testid="create-user-modal"]', { timeout: 15000 });
          await h.focus(page.getByTestId('create-user-email'), 1000);
          await h.focus(page.getByTestId('create-user-role'), 1000);
          await h.tap(page.getByTestId('create-user-cancel'));
          await page.waitForTimeout(700);
        },
      },
      {
        id: 'admin-access',
        narration:
          'The Access tab is the organisation-wide map: every project and workspace, who is a manager and who is a member, all in one place.',
        run: async (page, h) => {
          const tab = page.getByTestId('admin-tab-access');
          await h.focus(tab, 600);
          await h.tap(tab);
          await page.waitForSelector('[data-testid="admin-access-section"]', { timeout: 15000 }).catch(() => {});
          await h.focus(page.getByTestId('refresh-access'), 1300);
        },
      },
      {
        id: 'settings',
        narration:
          'Administrators also set the workspace retention policy, deciding how long run history is kept before it is cleaned up.',
        run: async (page, h) => {
          await openRail(page, h, 'rail-manage', '[data-testid="manage-page"]');
          const tab = page.getByTestId('manage-tab-settings');
          await h.focus(tab, 600);
          await h.tap(tab);
          await page.waitForTimeout(1600);
        },
      },
      {
        id: 'limits',
        narration:
          'From here Sam governs users, roles, access and retention across the whole organisation, the highest level of access in MockShift.',
        run: async (page, h) => {
          await h.focus(page.getByTestId('manage-tabs'), 900);
          await h.caption('Administrator: every rail unlocked');
          await page.waitForTimeout(600);
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
          'That is MockShift: one workspace where editors build and test, managers coordinate delivery, and administrators govern access. Sign in, open a collection and start shipping your APIs.',
        run: async (page, h) => {
          await h.goto('/login');
          h.narrateNow();
          await h.caption('MockShift — build, test, mock and document your APIs');
        },
      },
    ],
  },
];
