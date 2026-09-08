#!/usr/bin/env node
'use strict';

const { main } = require('../lib/cli');

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    const message = err && err.message ? err.message : String(err);
    process.stderr.write(`apihub: ${message}\n`);
    process.exitCode = err && err.exitCode !== undefined ? err.exitCode : 1;
  }
);
