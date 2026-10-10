'use strict';
// Throwaway CORS-enabled server used as the "user's localhost" target for the
// browser-run suite. Bound to all interfaces so both localhost and 127.0.0.1
// resolve. Port defaults to 8082 (override with argv[2] or E2E_LOCAL_PORT).

const http = require('http');
const port = Number(process.argv[2] || process.env.E2E_LOCAL_PORT || 8082);

http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, from: 'user-local-machine', path: req.url, method: req.method }));
  })
  .listen(port, () => console.log(`local echo on :${port}`));
