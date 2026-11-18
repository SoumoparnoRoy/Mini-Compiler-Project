// Local version of the site: serves the page and the same /api/run endpoint
// that Vercel runs, using the Windows build of the compiler.
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { runCompiler, MAX_SOURCE_BYTES } = require('./lib/run-compiler');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
// JSON escaping can make the body several times longer than the source.
const MAX_BODY_BYTES = MAX_SOURCE_BYTES * 6;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

function send(res, status, body, type) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      // No req.destroy() here: it closes the socket before the 413 reply goes out.
      if (size > MAX_BODY_BYTES) reject(new Error('too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleRun(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    const tooLarge = error.message === 'too large';
    return sendJson(res, tooLarge ? 413 : 400,
      { error: tooLarge ? 'The program is too large to run.' : 'The request was not valid JSON.' });
  }
  const result = await runCompiler(body && typeof body === 'object' ? body.source : undefined);
  sendJson(res, result.status, result.body);
}

async function handleStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
  }
  const file = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  // Refuse anything that resolves outside the public folder, such as /../server.js.
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !TYPES[path.extname(file)]) {
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
  try {
    send(res, 200, await fs.readFile(file), TYPES[path.extname(file)]);
  } catch {
    send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

const server = http.createServer((req, res) => {
  const route = req.url.split('?')[0];
  if (route === '/api/run') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST to run a program.' });
    return handleRun(req, res).catch((error) => {
      console.error('Run failed:', error.message);
      sendJson(res, 500, { error: 'The program could not be run.' });
    });
  }
  if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  return handleStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mini compiler prototype running at http://localhost:${PORT}`);
});
