'use strict';

const http = require('http');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/token') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'mock-token-abc123', token_type: 'Bearer' }));
    }
    if (req.url.startsWith('/echo')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ headers: req.headers, body: body || undefined }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
});

server.listen(3999, () => {
  // eslint-disable-next-line no-console
  console.log('[mock-upstream] listening on 3999');
});
