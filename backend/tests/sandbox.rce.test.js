'use strict';

const {
  FormulaRunner,
  SandboxError,
  SandboxTimeoutError,
  SandboxResourceError,
  SandboxExecutionError,
} = require('../src/sandbox/formulaRunner');

const HOST_SECRET = 's3cret-h0st-v4lue-9f8e7d6c';
process.env.SANDBOX_TEST_SECRET = HOST_SECRET;

const runner = new FormulaRunner({ poolSize: 4, memoryLimit: 64, timeoutMs: 50 });

function containsSecret(value) {
  if (typeof value === 'string') return value.includes(HOST_SECRET);
  if (Array.isArray(value)) return value.some((v) => containsSecret(v));
  if (value && typeof value === 'object') {
    return Object.values(value).some((v) => containsSecret(v));
  }
  return false;
}

const ESCAPE_ATTEMPTS = [
  ['process.env', 'req.body.leak = process.env;'],
  ['process.env.SECRET', 'req.body.leak = process.env.SANDBOX_TEST_SECRET;'],
  ['globalThis.process', 'req.body.leak = globalThis.process && globalThis.process.env;'],
  ['require("fs")', 'const fs = require("fs"); req.body.leak = fs.readFileSync("/etc/passwd", "utf8");'],
  ['require / module globals', 'req.body.leak = typeof require + "|" + typeof module;'],
  ['eval("process")', 'req.body.leak = eval("process");'],
  ['Function("return process")()', 'req.body.leak = Function("return process")();'],
  ['constructor.constructor escape', 'req.body.leak = ({}).constructor.constructor("return process")();'],
  ['this.constructor.constructor escape', 'req.body.leak = this.constructor.constructor("return process")();'],
  ['process.binding', 'req.body.leak = process.binding("fs");'],
  ['fetch exfiltration', 'req.body.leak = typeof fetch;'],
  ['timers (setTimeout)', 'req.body.leak = typeof setTimeout;'],
  ['Buffer/TypedArray host refs', 'req.body.leak = typeof Buffer;'],
  ['dns/network via imports', 'req.body.leak = typeof XMLHttpRequest;'],
  ['new Function("return this") reach', 'const g = new Function("return this")(); req.body.leak = g.process && g.process.env;'],
];

describe('sandbox RCE containment', () => {
  test.each(ESCAPE_ATTEMPTS)('%s is contained', async (label, source) => {
    let outcome;
    try {
      outcome = await runner.run({ source, req: { body: {} }, vars: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxError);
      expect(err.message).not.toContain(HOST_SECRET);
      return;
    }
    expect(containsSecret(outcome)).toBe(false);
    expect(containsSecret({ vars: outcome.vars, req: outcome.req })).toBe(false);
    if (outcome.req && outcome.req.body && typeof outcome.req.body.leak === 'string') {
      expect(outcome.req.body.leak).not.toContain('process');
    }
  });

  test('infinite loop is killed by the execution timeout', async () => {
    await expect(runner.run({ source: 'while (true) {}', req: {}, vars: {} })).rejects.toBeInstanceOf(
      SandboxTimeoutError
    );
  });

  test('unbounded memory allocation is killed by the memory limit', async () => {
    await expect(
      runner.run({ source: 'const a = new Uint8Array(1e9); req.body.x = a.length;', req: { body: {} }, vars: {} })
    ).rejects.toBeInstanceOf(SandboxResourceError);
  });

  test('prototype pollution does not escape into the host realm', async () => {
    const outcome = await runner.run({
      source:
        'req.body.__proto__.polluted = true; req.body.constructor.prototype.polluted = true; req.body.x = 1;',
      req: { body: {} },
      vars: {},
    });
    expect({}.polluted).toBeUndefined();
    expect(outcome.req.body.polluted).toBeUndefined();
    expect(outcome.req.body.x).toBe(1);
  });

  test('a formula error surfaces as SandboxExecutionError', async () => {
    await expect(
      runner.run({ source: 'throw new Error("boom")', req: {}, vars: {} })
    ).rejects.toBeInstanceOf(SandboxExecutionError);
  });
});

describe('sandbox legitimate usage', () => {
  test('math, dates, and helpers compute correctly', async () => {
    const outcome = await runner.run({
      source: [
        'req.body.order_id = $vars.base + 1;',
        'req.body.total = 19.99 * 2;',
        'req.body.rounded = $utils.round(3.14159, 2);',
        'req.body.date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString();',
        'req.body.future = $utils.addDays("2026-01-01T00:00:00.000Z", 7);',
        'req.body.guid = $utils.uuid();',
      ].join('\n'),
      req: { body: {} },
      vars: { base: 100 },
    });
    expect(outcome.req.body.order_id).toBe(101);
    expect(outcome.req.body.total).toBeCloseTo(39.98);
    expect(outcome.req.body.rounded).toBe(3.14);
    expect(outcome.req.body.date).toBe('2026-01-01T00:00:00.000Z');
    expect(outcome.req.body.future).toBe('2026-01-08T00:00:00.000Z');
    expect(outcome.req.body.guid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test('returned object is captured without leaking host references', async () => {
    const outcome = await runner.run({
      source: '({ body: { order_id: $vars.base + 1 } })',
      req: { body: {} },
      vars: { base: 5 },
    });
    expect(outcome.returned).toEqual({ body: { order_id: 6 } });
  });

  test('time, string and base64 helpers compute correctly', async () => {
    const outcome = await runner.run({
      source: [
        'req.body.hours = $utils.addHours("2026-01-01T00:00:00.000Z", 2);',
        'req.body.minutes = $utils.addMinutes("2026-01-01T00:00:00.000Z", 30);',
        'req.body.months = $utils.addMonths("2026-01-31T00:00:00.000Z", 1);',
        'req.body.ts = $utils.timestamp();',
        'req.body.cap = $utils.capitalize("hello world");',
        'req.body.lower = $utils.lower("HeLLo");',
        'req.body.upper = $utils.upper("HeLLo");',
        'req.body.trimmed = $utils.trim("  spaced  ");',
        'req.body.b64 = $utils.base64Encode("héllo → 🌍");',
        'req.body.b64dec = $utils.base64Decode("aGVsbG8gd29ybGQ=");',
      ].join('\n'),
      req: { body: {} },
      vars: {},
    });
    expect(outcome.req.body.hours).toBe('2026-01-01T02:00:00.000Z');
    expect(outcome.req.body.minutes).toBe('2026-01-01T00:30:00.000Z');
    expect(outcome.req.body.months).toBe('2026-02-28T00:00:00.000Z');
    expect(typeof outcome.req.body.ts).toBe('number');
    expect(outcome.req.body.cap).toBe('Hello world');
    expect(outcome.req.body.lower).toBe('hello');
    expect(outcome.req.body.upper).toBe('HELLO');
    expect(outcome.req.body.trimmed).toBe('spaced');
    expect(outcome.req.body.b64).toBe('aMOpbGxvIOKGkiDwn4yN');
    expect(outcome.req.body.b64dec).toBe('hello world');
  });
});
