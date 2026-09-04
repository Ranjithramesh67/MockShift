import { test, expect } from '@playwright/test';

/**
 * Team-scoped workspace navigation + project command center:
 *  - creating a team and sharing a workspace to it groups that workspace under
 *    the team in the sidebar (team-group-<name> header, chip preserved)
 *  - clicking a project name in the tree opens the Project Overview
 *  - the overview shows the workspace info panel, member stat tiles, and the
 *    Members & Access tab with managers/members and admin grant controls.
 *
 * Depends on the seed data created by `cd backend && npm run seed:dev`.
 */
test('team grouping and project overview command center', async ({ page }) => {
  const teamName = 'E2E Team';

  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // Idempotent setup: remove any prior "E2E Team", then create a fresh one and
  // share "My Workspace" with it.
  const teamsRes = await page.request.get('/api/teams');
  const teams = (await teamsRes.json()).teams as Array<{ id: string; name: string }>;
  for (const t of teams.filter((t) => t.name === teamName)) {
    await page.request.delete(`/api/teams/${t.id}`);
  }
  const created = await page.request.post('/api/teams', { data: { name: teamName } });
  expect(created.ok()).toBeTruthy();
  const teamId = ((await created.json()) as { team: { id: string } }).team.id;

  const wsRes = await page.request.get('/api/workspaces');
  const workspaces = (await wsRes.json()).workspaces as Array<{ id: string; name: string }>;
  const myWs = workspaces.find((w) => w.name === 'My Workspace')!;
  const shared = await page.request.post(`/api/workspaces/${myWs.id}/teams`, {
    data: { teamId, role: 'EDITOR' },
  });
  expect(shared.ok()).toBeTruthy();

  // Reload so the sidebar rebuilds the grouped navigation.
  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  // "My Workspace" is now grouped under the team, still selectable.
  await expect(page.getByTestId(`team-group-${teamName}`)).toBeVisible();
  await page.getByTestId('workspace-My Workspace').click();
  await expect(page.getByTestId('request-configurator')).toBeVisible();

  // Open the project overview by clicking the project name in the tree.
  await page.getByRole('button', { name: 'Open Default Project overview' }).click();
  await expect(page.getByTestId('project-overview')).toBeVisible();
  await expect(page.getByTestId('project-overview')).toContainText('Default Project');
  await expect(page.getByTestId('project-tab-overview')).toContainText('Overview');

  // Overview tiles + workspace info panel.
  await expect(page.getByTestId('project-overview')).toContainText('Collections');
  await expect(page.getByTestId('project-overview')).toContainText('My Workspace');

  // Members tab lists managers and members with roles; admin controls shown.
  await page.getByTestId('project-tab-members').click();
  await expect(page.getByTestId('project-overview')).toContainText('PM');
  await expect(page.getByTestId('project-overview')).toContainText('MANAGER');
  await expect(page.getByTestId('add-member-user')).toBeVisible();

  // Activity tab renders (seed has run history or the empty state).
  await page.getByTestId('project-tab-activity').click();
  await expect(page.getByTestId('project-overview')).toContainText(/Status|No recent runs/);

  // Closing the overview returns to the normal editor empty state.
  await page.getByTestId('close-project-overview').click();
  await expect(page.getByTestId('project-overview')).toHaveCount(0);
  await expect(page.getByTestId('request-configurator')).toBeVisible();
});
