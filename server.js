'use strict';

/**
 * Phase 1: a local, read-only window onto the agents running on this machine.
 *
 * Binds to localhost only. It serves one page and one JSON endpoint, and it
 * never writes anything, sends input to an agent, or starts or stops one.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { snapshot } = require('./engine/status');

const PORT = Number(process.env.PORT || 4317);

const server = http.createServer((req, res) => {
  if (req.url === '/api/status') {
    let body;
    try {
      body = JSON.stringify(snapshot());
    } catch (err) {
      // Failing loudly beats serving a stale or empty board that looks healthy.
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err && err.message) }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  const file = path.join(__dirname, 'web', 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('could not read the page');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Agent Workforce (read-only) on http://127.0.0.1:${PORT}\n`);
});
