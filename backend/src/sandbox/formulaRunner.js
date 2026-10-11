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
  const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const utf8Encode = (str) => {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      let code = str.codePointAt(i);
      if (code > 0xffff) i += 1;
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return bytes;
  };
  const utf8Decode = (bytes) => {
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      let code;
      let extra;
      if (b < 0x80) {
        code = b;
        extra = 0;
      } else if ((b & 0xe0) === 0xc0) {
        code = b & 0x1f;
        extra = 1;
      } else if ((b & 0xf0) === 0xe0) {
        code = b & 0x0f;
        extra = 2;
      } else if ((b & 0xf8) === 0xf0) {
        code = b & 0x07;
        extra = 3;
      } else {
        i += 1;
        continue;
      }
      if (i + extra >= bytes.length) break;
      for (let j = 1; j <= extra; j += 1) {
        code = (code << 6) | (bytes[i + j] & 0x3f);
      }
      out += String.fromCodePoint(code);
      i += extra + 1;
    }
    return out;
  };
  const base64EncodeBytes = (bytes) => {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += B64_ALPHABET[b0 >> 2];
      out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
      out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
      out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
    }
    return out;
  };
  const base64DecodeBytes = (b64) => {
    const chars = String(b64).replace(/=+$/, '');
    const bytes = [];
    for (let i = 0; i < chars.length; i += 4) {
      const c0 = B64_ALPHABET.indexOf(chars[i]);
      const c1 = B64_ALPHABET.indexOf(chars[i + 1]);
      const c2 = i + 2 < chars.length ? B64_ALPHABET.indexOf(chars[i + 2]) : -1;
      const c3 = i + 3 < chars.length ? B64_ALPHABET.indexOf(chars[i + 3]) : -1;
      bytes.push((c0 << 2) | (c1 >> 4));
      if (c2 >= 0) bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
      if (c3 >= 0) bytes.push(((c2 & 0x03) << 6) | c3);
    }
    return bytes;
  };
  const $utils = Object.freeze({
    uuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }),
    randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
    now: () => new Date().toISOString(),
    timestamp: () => Date.now(),
    addDays: (iso, days) => new Date(Date.parse(iso) + days * 86400000).toISOString(),
    addHours: (iso, hours) => new Date(Date.parse(iso) + hours * 3600000).toISOString(),
    addMinutes: (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString(),
    addMonths: (iso, months) => {
      const d = new Date(Date.parse(iso));
      const target = new Date(Date.UTC(
        d.getUTCFullYear(), d.getUTCMonth() + months, 1,
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()
      ));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
      return target.toISOString();
    },
    round: (n, precision) => Number(n.toFixed(precision)),
    capitalize: (value) => {
      const s = String(value);
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    lower: (value) => String(value).toLowerCase(),
    upper: (value) => String(value).toUpperCase(),
    trim: (value) => String(value).trim(),
    base64Encode: (value) => base64EncodeBytes(utf8Encode(String(value))),
    base64Decode: (value) => utf8Decode(base64DecodeBytes(String(value)))
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
