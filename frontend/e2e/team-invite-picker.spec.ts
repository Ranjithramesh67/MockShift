import { test, expect } from '@playwright/test';

/**
 * Teams modal: clicking a team name opens that team only; people suggestions
 * appear after typing. Depends on `cd backend && npm run seed:dev`.
 */
test('searchable list adds an org user to a team', async ({ page }) => {
  const teamName = 'E2E Picker Team';

  await page.goto('/login');
  await page.getByTestId('login-email').fill('boss1785867669@test.io');
  await page.getByTestId('login-password').fill('bosspass123');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('sidebar')).toBeVisible();

  const teamsRes = await page.request.get('/api/teams');
  const teams = (await teamsRes.json()).teams as Array<{ id: string; name: string }>;
  for (const t of teams.filter((t) => t.name === teamName)) {
    await page.request.delete(`/api/teams/${t.id}`);
  }
  const created = await page.request.post('/api/teams', { data: { name: teamName } });
  expect(created.ok()).toBeTruthy();
  const teamId = ((await created.json()) as { team: { id: string } }).team.id;

  await page.reload();
  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.getByTestId('rail-teams').click();
  await page.getByTestId(`open-team-${teamName}`).click();
  const modal = page.getByTestId('teams-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('heading', { name: teamName })).toBeVisible();
  await expect(modal.getByTestId(`team-detail-${teamId}`)).toBeVisible();
  await expect(modal.getByRole('heading', { name: 'Create team' })).toHaveCount(0);

  const form = page.getByTestId(`invite-form-${teamId}`);
  await expect(form).toBeVisible();
  const candidate = form.getByTestId('invite-user-dev');
  await expect(candidate).toHaveCount(0);
  await form.getByTestId('invite-email').fill('dev');
  await expect(candidate).toBeVisible();
  await candidate.click();
  await form.getByTestId('invite-role').selectOption('VIEWER');
  await form.getByTestId(`invite-${teamId}`).click();

  await expect(modal.locator('.share-row', { hasText: 'Dev (@dev)' })).toBeVisible();
  await expect(modal.locator('.share-row', { hasText: 'Dev (@dev)' })).toContainText('VIEWER');
  await expect(candidate).toHaveCount(0);
});
