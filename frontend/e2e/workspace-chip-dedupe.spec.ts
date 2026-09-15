import { test, expect } from '@playwright/test';

/**
 * HIGH-6 regression: a workspace can be shared to several teams, but the
 * sidebar must render its chip exactly once (duplicate `workspace-<name>`
 * testids broke a swathe of specs). Depends on `cd backend && npm run seed:dev`.
 */
test('a workspace shared to two teams renders a single chip', async ({ page }) => {
  const stamp = Date.now();
  const wsName = `DedupeChip_${stamp}`;
  const teamA = `DedupeTeamA_${stamp}`;
  const teamB = `DedupeTeamB_${stamp}`;

  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const created = await page.request.post('/api/workspaces', { data: { name: wsName } });
  expect(created.ok()).toBeTruthy();
  const wsId = ((await created.json()) as { workspace: { id: string } }).workspace.id;

  const teamARes = await page.request.post('/api/teams', { data: { name: teamA } });
  const teamBRes = await page.request.post('/api/teams', { data: { name: teamB } });
  expect(teamARes.ok()).toBeTruthy();
  expect(teamBRes.ok()).toBeTruthy();
  const teamAId = ((await teamARes.json()) as { team: { id: string } }).team.id;
  const teamBId = ((await teamBRes.json()) as { team: { id: string } }).team.id;

  await page.request.post(`/api/workspaces/${wsId}/teams`, { data: { teamId: teamAId } });
  await page.request.post(`/api/workspaces/${wsId}/teams`, { data: { teamId: teamBId } });

  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const collapse = page.getByTestId('collapse-workspaces');
  if ((await collapse.getAttribute('aria-expanded')) === 'false') await collapse.click();

  await expect(page.locator('[data-testid^="team-group-"]').first()).toBeVisible();
  await expect(page.getByTestId(`workspace-${wsName}`)).toBeVisible();
  await expect(page.getByTestId(`workspace-${wsName}`)).toHaveCount(1);

  await page.request.delete(`/api/workspaces/${wsId}`);
  await page.request.delete(`/api/teams/${teamAId}`);
  await page.request.delete(`/api/teams/${teamBId}`);
});
