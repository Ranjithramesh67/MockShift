import { Page } from '@playwright/test';

/**
 * Signs up a fresh, uniquely-named user through the API. The session cookie is
 * shared with the browser context, so subsequent page navigations stay
 * authenticated. Returns the email used (unique per call).
 */
export async function signupFreshUser(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 100000)}@test.io`;
  const res = await page.request.post('/api/auth/signup', {
    data: { email, password: 'e2epassword123', name: 'E2E User' },
  });
  if (!res.ok()) {
    throw new Error(`signup failed: ${res.status()} ${await res.text()}`);
  }
  return email;
}
