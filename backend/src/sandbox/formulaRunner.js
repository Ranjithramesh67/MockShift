'use strict';

const ivm = require('isolated-vm');

class SandboxError extends Error {
  constructor(message, name) {
    super(message);
    this.name = name;
  }
}

class SandboxExecutionError extends SandboxError {
  constructor(message, cause) {
    super(message, 'SandboxExecutionError');
    this.cause = cause;
  }
}

class SandboxTimeoutError extends SandboxError {
  constructor(message) {
    super(message, 'SandboxTimeoutError');
  }
}

class SandboxResourceError extends SandboxError {
  constructor(message) {
    super(message, 'SandboxResourceError');
  }
}

function toTransferable(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isResourceFailure(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  return err instanceof RangeError || msg.includes('Array buffer allocation failed') || msg.includes('heap limit');
}

function normalizeError(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  if (msg.includes('timed out')) {
    return new SandboxTimeoutError('Formula exceeded the execution time limit');
  }
  if (isResourceFailure(err)) {
    return new SandboxResourceError('Formula exceeded the sandbox memory limit');
  }
  return new SandboxExecutionError(`Formula execution failed: ${msg}`, err);
}

const HELPERS_SOURCE = `
(() => {
  const $utils = Object.freeze({
    uuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }),
    randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    now: () => new Date().toISOString(),
    addDays: (iso, days) => new Date(Date.parse(iso) + days * 86400000).toISOString(),
    round: (n, precision) => Number(n.toFixed(precision))
  });
  globalThis.$utils = $utils;
})();
`;

class SandboxPool {
  constructor({ size = 2, memoryLimit = 64 }) {
    this.size = size;
    this.memoryLimit = memoryLimit;
    this.idle = [];
    this.waiters = [];
    this.created = 0;
  }

  async acquire() {
    for (;;) {
      if (this.idle.length > 0) {
        const iso = this.idle.pop();
        if (!iso.dead) return iso;
        try {
          iso.isolate.dispose();
        } catch {
          // already disposed by the isolate runtime
        }
        this.created -= 1;
        continue;
      }
      if (this.created < this.size) {
        this.created += 1;
        return { isolate: new ivm.Isolate({ memoryLimit: this.memoryLimit }) };
      }
      await new Promise((resolve) => this.waiters.push(resolve));
    }
  }

  release(iso) {
    if (iso.dead) {
      try {
        iso.isolate.dispose();
      } catch {
        // already disposed by the isolate runtime
      }
      this.created -= 1;
      if (this.waiters.length > 0) {
        this.waiters.shift()();
      }
      return;
    }
    if (this.waiters.length > 0) {
      this.idle.push(iso);
      this.waiters.shift()();
      return;
    }
    this.idle.push(iso);
  }
}

const SRC_GLOBAL = '$__formulaSource';
const RETURN_GLOBAL = '$__return';

function readJson(context, globalName) {
  const raw = context.evalSync(
    `typeof ${globalName} === 'undefined' ? undefined : JSON.stringify(${globalName})`
  );
  return raw === undefined ? undefined : JSON.parse(raw);
}

class FormulaRunner {
  constructor({ poolSize = 2, memoryLimit = 64, timeoutMs = 100 } = {}) {
    this.timeoutMs = timeoutMs;
    this.pool = new SandboxPool({ size: poolSize, memoryLimit });
  }

  async run({ source, req = {}, vars = {}, globals = {}, filename = 'formula.js', timeoutMs = this.timeoutMs }) {
    if (typeof source !== 'string' || source.trim().length === 0) {
      return { req: toTransferable(req), vars: toTransferable(vars), returned: undefined };
    }
    const iso = await this.pool.acquire();
    try {
      const context = iso.isolate.createContextSync();
      const jail = context.global;
      jail.setSync('req', new ivm.ExternalCopy(toTransferable(req)).copyInto());
      jail.setSync('$vars', new ivm.ExternalCopy(toTransferable(vars)).copyInto());
      for (const [key, value] of Object.entries(globals)) {
        jail.setSync(key, new ivm.ExternalCopy(toTransferable(value)).copyInto());
      }
      jail.setSync(SRC_GLOBAL, String(source));
      context.evalSync(HELPERS_SOURCE);
      context.evalSync(`${RETURN_GLOBAL} = eval(${SRC_GLOBAL});`, { timeout: timeoutMs });
      return {
        req: readJson(context, 'req'),
        vars: readJson(context, '$vars'),
        returned: readJson(context, RETURN_GLOBAL),
      };
    } catch (err) {
      if (isResourceFailure(err)) {
        iso.dead = true;
      }
      throw normalizeError(err);
    } finally {
      this.pool.release(iso);
    }
  }
}

module.exports = {
  FormulaRunner,
  SandboxError,
  SandboxExecutionError,
  SandboxTimeoutError,
  SandboxResourceError,
};
