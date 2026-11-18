// Sends the 38 console checks through the website's /api/run endpoint.
// Usage: node tests/check-prototype.js [base URL, default http://localhost:3000]
// Against the local server on Windows it also runs the compiler directly on
// each case and checks the website returns exactly the same output.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE_URL = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const LOCAL_BINARY = path.join(__dirname, '..', 'bin', 'mini_compiler.exe');
const compareDirect = process.platform === 'win32' && BASE_URL.includes('localhost') &&
  fs.existsSync(LOCAL_BINARY);

const cases = [
  ['precedence', 'int x; x = 2 + 3 * 4; print x;', 'x = 14', 0],
  ['parentheses', 'int x; x = (2 + 3) * 4; print x;', 'x = 20', 0],
  ['left associative division', 'int x; x = 20 / 2 / 2; print x;', 'x = 5', 0],
  ['left associative subtraction', 'int x; x = 10 - 3 - 2; print x;', 'x = 5', 0],
  ['int division', 'int x; x = 5 / 2; print x;', 'x = 2', 0],
  ['float division', 'float x; x = 5 / 2.0; print x;', 'x = 2.50', 0],
  ['int expression assigned to float', 'float x; x = 5 / 2; print x;', 'x = 2.00', 0],
  ['implicit widening', 'float x; x = 2; print x;', 'x = 2.00', 0],
  ['unary minus', 'int x; x = -3 * 2; print x;', 'x = -6', 0],
  ['negative division', 'int x; x = -5 / 2; print x;', 'x = -2', 0],
  ['double unary', 'int x; x = --3; print x;', 'x = 3', 0],
  ['expression in print', 'print (2 + 3) * 4;', '_t2 = 20', 0],
  ['print at statement time', 'int x; x = 1; print x; x = 2; print x;', 'x = 1\nx = 2', 0],
  ['self assignment', 'int x; x = 4; x = x + 1; print x;', 'x = 5', 0],
  ['decimal without leading zero', 'float x; x = .5; print x;', 'x = 0.50', 0],
  ['comments and line endings', '// comment\r\nint x;\r\nx = 3; // c\r\nprint x;', 'x = 3', 0],
  ['temp name isolation', 'int t1; t1 = 2 + 3; print t1;', 't1 = 5', 0],
  ['no print', 'int x; x = 2;', 'No print statements.', 0],
  ['empty source', '', 'source file is empty', 1],
  ['undeclared assignment', 'x = 1;', "'x' is not declared", 1],
  ['undeclared operand', 'int x;\nx = y + 1;', "line 2: 'y' is not declared", 1],
  ['uninitialized variable', 'int x; print x;', 'has no value yet', 1],
  ['uninitialized self assignment', 'int x; x = x + 1;', 'has no value yet', 1],
  ['duplicate declaration', 'int x; float x;', 'already declared', 1],
  ['narrowing assignment', 'int x; x = 3.5;', 'cannot assign a float value', 1],
  ['mixed result assigned to int', 'int x; x = 2 + 0.5;', 'cannot assign a float value', 1],
  ['missing semicolon', 'int x\nx = 2;', "expected ';'", 1],
  ['unclosed parentheses', 'int x; x = (2 + 3;', "expected ')'", 1],
  ['incomplete expression', 'int x; x = 2 + ;', 'expected a number', 1],
  ['invalid character', 'print 2 % 1;', 'unexpected character', 1],
  ['division by zero', 'float x;\nx = 3 / 0.0;', 'line 2: division by zero', 1],
  ['calculated zero divisor', 'print 3 / (2 - 2);', 'division by zero', 1],
  ['integer overflow', 'print 2147483647 + 1;', 'integer result is outside', 1],
  ['int literal limit', 'print 2147483648;', 'number is outside the supported range', 1],
  ['long name', 'int ' + 'a'.repeat(64) + ';', 'name or number is too long', 1],
  ['deep expression', 'print ' + '('.repeat(70) + '1' + ')'.repeat(70) + ';', 'nested too deeply', 1],
  ['source size limit', ' '.repeat(16001), 'file is too large', 1],
  ['null byte', 'int x;\u0000print 1;', 'null character', 1]
];

const normalise = (text) => text.replace(/\r\n/g, '\n');

function runDirect(source) {
  const file = path.join(os.tmpdir(), `mini-check-${process.pid}.txt`);
  fs.writeFileSync(file, source);
  try {
    return { exitCode: 0, output: normalise(execFileSync(LOCAL_BINARY, [file], { encoding: 'utf8', stdio: 'pipe' })) };
  } catch (error) {
    return { exitCode: error.status, output: normalise(error.stdout + error.stderr) };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

async function post(body, method = 'POST') {
  const response = await fetch(`${BASE_URL}/api/run`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

async function main() {
  let failures = 0;
  const check = (name, passed, detail) => {
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}${passed ? '' : ` (${detail})`}`);
    if (!passed) failures++;
  };

  for (const [name, source, expected, exitCode] of cases) {
    const { status, data } = await post({ source });
    const output = normalise(data.stdout + data.stderr);
    let passed = status === 200 && data.exitCode === exitCode && output.includes(expected);
    if (exitCode) passed = passed && !output.includes('Compilation successful.');
    if (passed && compareDirect) {
      const direct = runDirect(source);
      passed = direct.exitCode === data.exitCode && direct.output === output;
    }
    check(name, passed, JSON.stringify({ status, data }));
  }

  // Limits enforced by the server rather than the C program.
  let reply = await post({ source: 'x'.repeat(40000) });
  check('server rejects oversized source', reply.status === 413, reply.status);
  reply = await post({ source: 'x'.repeat(200000) });
  check('server rejects oversized request body', reply.status === 413, reply.status);
  reply = await post({ source: 42 });
  check('server rejects non-text source', reply.status === 400, reply.status);
  reply = await post(null, 'GET');
  check('server rejects GET on /api/run', reply.status === 405, reply.status);

  console.log(`\n${cases.length + 4 - failures} passed, ${failures} failed against ${BASE_URL}` +
    (compareDirect ? ' (outputs compared with the compiler run directly)' : ''));
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
