'use strict';

const leakRe = /invalid input syntax|syntax error at|duplicate key value|relation "|violates .*constraint|pg_/i;

async function loginCookie(config) {
  const res = await fetch(`${config.MAIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.BOSS.email, password: config.BOSS.pass }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = /ah\.session=([^;]+)/.exec(setCookie);
  return m ? `ah.session=${m[1]}` : '';
}

async function call(config, apiPath, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(config.MAIN + apiPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}

module.exports = {
  name: 'api-validation',
  async run({ config, report }) {
    const cookie = config.BOSS.pass ? await loginCookie(config) : '';
    const expectClean4xx = (id, res) => {
      if (res.status < 500 && !leakRe.test(res.text)) report.pass(id, String(res.status));
      else report.fail(id, `${res.status} ${res.text.slice(0, 90)}`);
    };
    const expectStatus = (id, res, want) => {
      if (res.status === want) report.pass(id, String(want));
      else report.fail(id, `expected ${want}, got ${res.status} ${res.text.slice(0, 70)}`);
    };

    // Malformed input must be 4xx with no raw Postgres details.
    expectClean4xx('api.history-negative-limit', await call(config, '/api/history?limit=-1', { cookie }));
    expectClean4xx('api.notifications-negative-limit', await call(config, '/api/notifications?limit=-1', { cookie }));
    expectClean4xx('api.bad-uuid-workspace-content', await call(config, '/api/workspaces/not-a-uuid/content', { cookie }));
    expectClean4xx('api.bad-uuid-environment-vars', await call(config, '/api/environments/not-a-uuid/variables', { cookie }));
    expectClean4xx(
      'api.bad-uuid-monitor',
      await call(config, '/api/monitors', {
        method: 'POST',
        cookie,
        body: { projectId: 'not-a-uuid', name: 'x', url: 'http://x', intervalMinutes: 5 },
      })
    );
    expectClean4xx(
      'api.bad-cron-automation',
      await call(config, '/api/automations', {
        method: 'POST',
        cookie,
        body: { projectId: 'not-a-uuid', name: 'x', cron: 'nonsense' },
      })
    );

    // New browser-run endpoints are auth-gated.
    expectStatus('api.runs-prepare-requires-auth', await call(config, '/api/runs/prepare', { method: 'POST', body: { method: 'GET', url: 'http://localhost:1/x' } }), 401);
    expectStatus('api.runs-complete-requires-auth', await call(config, '/api/runs/complete', { method: 'POST', body: {} }), 401);

    expectStatus('api.health-200', await call(config, '/api/health'), 200);
  },
};
