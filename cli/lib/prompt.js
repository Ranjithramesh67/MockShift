'use strict';

const readline = require('readline');

function promptText(question, defaultValue) {
  const suffix = defaultValue !== undefined && defaultValue !== null ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      const trimmed = String(answer || '').trim();
      if (trimmed) resolve(trimmed);
      else if (defaultValue !== undefined && defaultValue !== null) resolve(String(defaultValue));
      else resolve('');
    });
  });
}

function promptSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptText(question);
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    const write = (text) => process.stdout.write(text);
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdin.removeListener('error', onError);
    };
    const onData = (chunk) => {
      const text = String(chunk);
      for (const ch of text) {
        if (ch === '\u0003') {
          write('\n');
          cleanup();
          reject(new Error('Interrupted'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          write('\n');
          cleanup();
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (ch === '\u001b') {
          cleanup();
          write('\n');
          reject(new Error('Terminal escape sequence not supported while entering a secret'));
          return;
        }
        value += ch;
      }
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.on('error', onError);
  });
}

module.exports = { promptText, promptSecret };
