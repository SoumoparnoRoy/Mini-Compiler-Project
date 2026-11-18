const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// The C program reads at most 15,999 bytes and reports longer files itself,
// so this larger cap only stops oversized requests before they reach the disk.
const MAX_SOURCE_BYTES = 32000;
const TIME_LIMIT_MS = 2000;
const OUTPUT_LIMIT_BYTES = 64 * 1024;

const binaryName = process.platform === 'win32' ? 'mini_compiler.exe' : 'mini_compiler-linux';
const bundledBinary = path.join(__dirname, '..', 'bin', binaryName);
let binaryReady = null;

function getBinary() {
  if (process.platform === 'win32') return Promise.resolve(bundledBinary);
  // Vercel's function folder is read-only and uploads can lose the execute
  // bit, so the Linux build runs from a copy in /tmp.
  if (!binaryReady) {
    const copy = path.join(os.tmpdir(), binaryName);
    binaryReady = fs.copyFile(bundledBinary, copy)
      .then(() => fs.chmod(copy, 0o755))
      .then(() => copy)
      .catch((error) => {
        binaryReady = null;
        throw error;
      });
  }
  return binaryReady;
}

function runFile(binary, file) {
  return new Promise((resolve, reject) => {
    // execFile passes the path as a single argument with no shell involved,
    // so nothing in the user's source can be read as a command.
    execFile(binary, [file], {
      timeout: TIME_LIMIT_MS,
      maxBuffer: OUTPUT_LIMIT_BYTES,
      windowsHide: true,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ ok: true, exitCode: 0, stdout, stderr });
      } else if (error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        resolve({
          ok: false,
          exitCode: null,
          stdout: '',
          stderr: 'The compiler took too long or produced too much output.'
        });
      } else if (typeof error.code === 'number') {
        resolve({ ok: false, exitCode: error.code, stdout, stderr });
      } else {
        reject(error);
      }
    });
  });
}

async function runCompiler(source) {
  if (typeof source !== 'string') {
    return { status: 400, body: { error: 'Send the program as text in the "source" field.' } };
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    return { status: 413, body: { error: 'The program is too large to run.' } };
  }

  const file = path.join(os.tmpdir(), `mini-${crypto.randomUUID()}.txt`);
  try {
    await fs.writeFile(file, source, { flag: 'wx' });
    const result = await runFile(await getBinary(), file);
    return { status: 200, body: result };
  } catch (error) {
    console.error('Could not start the compiler:', error.message);
    return { status: 500, body: { error: 'The compiler could not be started.' } };
  } finally {
    await fs.rm(file, { force: true });
  }
}

module.exports = { runCompiler, MAX_SOURCE_BYTES };
