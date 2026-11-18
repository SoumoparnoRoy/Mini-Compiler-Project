const EXAMPLES = {
  percentage: `int marks;
float percentage;
marks = 420;
percentage = (marks / 500.0) * 100;
print marks;
print percentage;
`,
  division: `int total;
int subjects;
float average;
total = 427;
subjects = 5;
// Both operands are int, so the fraction is dropped before widening.
average = total / subjects;
print average;
// 5.0 is a float, so total is widened first.
average = total / 5.0;
print average;
`,
  undeclared: `int marks;
float percentage;
marks = 420;
percentage = mark / 500.0 * 100;
print percentage;
`,
  typeError: `int marks;
marks = 420.5;
print marks;
`
};

// Which stage produced each error, matched against the C program's messages.
const STAGE_BY_MESSAGE = [
  [/unexpected character|too long|number is outside the supported range|null character|file is too large/, 'lexical'],
  [/expected|nested too deeply|source file is empty/, 'syntax'],
  [/not declared|no value yet|already declared|cannot assign|too many variables/, 'semantic'],
  [/too many instructions|too many temporary/, 'tac'],
  [/division by zero|result is outside|result is too large/, 'execution']
];
const STAGES = ['lexical', 'syntax', 'semantic', 'tac', 'execution'];
const MAX_BYTES = 15999;

const source = document.getElementById('source');
const gutter = document.getElementById('gutter');
const size = document.getElementById('size');
const runButton = document.getElementById('run');
const status = document.getElementById('status');
const tac = document.getElementById('tac');
const output = document.getElementById('output');
const tempNote = document.getElementById('temp-note');
const stageItems = document.querySelectorAll('#stages li');
const encoder = new TextEncoder();
let errorLine = null;

function updateGutter() {
  const lines = source.value.split('\n').length;
  const rows = [];
  for (let i = 1; i <= lines; i++) {
    rows.push(`<div${i === errorLine ? ' class="error-line"' : ''}>${i}</div>`);
  }
  gutter.innerHTML = rows.join('');
  gutter.scrollTop = source.scrollTop;
  const bytes = encoder.encode(source.value).length;
  size.textContent = `${bytes.toLocaleString('en-IN')} / 15,999 bytes`;
  size.classList.toggle('over', bytes > MAX_BYTES);
}

function setStages(failedStage) {
  const failedIndex = failedStage ? STAGES.indexOf(failedStage) : STAGES.length;
  stageItems.forEach((item, index) => {
    item.classList.toggle('passed', index < failedIndex);
    item.classList.toggle('failed', index === failedIndex);
  });
}

function clearStages() {
  stageItems.forEach((item) => item.classList.remove('passed', 'failed'));
}

function showEmpty(element, text) {
  element.textContent = text;
  element.classList.add('empty');
}

function showCode(element, text) {
  element.textContent = text;
  element.classList.remove('empty');
}

function resetResults(message) {
  errorLine = null;
  clearStages();
  status.className = 'status';
  status.textContent = message;
  showEmpty(tac, 'Shown after a successful run');
  showEmpty(output, 'Shown after a successful run');
  tempNote.hidden = true;
  updateGutter();
}

function showError(message) {
  const lineMatch = message.match(/^Error on line (\d+)/);
  errorLine = lineMatch ? Number(lineMatch[1]) : null;
  const stage = STAGE_BY_MESSAGE.find(([pattern]) => pattern.test(message));
  setStages(stage ? stage[1] : 'lexical');
  status.className = 'status error';
  status.textContent = message;
  showEmpty(tac, 'Not generated because the program has an error');
  showEmpty(output, 'Not run because the program has an error');
  tempNote.hidden = true;
  updateGutter();
}

function showSuccess(stdout) {
  // The C program prints the TAC and the results under these two headings.
  const [, afterTac = ''] = stdout.split('Three-address code:\n');
  const [tacText = '', outputText = ''] = afterTac.split('\nProgram output:\n');
  errorLine = null;
  setStages(null);
  status.className = 'status ok';
  status.textContent = 'Compilation successful.';
  showCode(tac, tacText.trim());
  showCode(output, outputText.trim());
  tempNote.hidden = !/^_t\d+ = /m.test(outputText);
  updateGutter();
}

async function run() {
  if (runButton.getAttribute('aria-busy') === 'true') return;
  runButton.setAttribute('aria-busy', 'true');
  status.className = 'status';
  status.textContent = 'Running…';
  try {
    const response = await fetch('api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: source.value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      resetResults(data.error || 'The server could not run the program.');
      status.className = 'status error';
      return;
    }
    const stdout = data.stdout.replace(/\r\n/g, '\n');
    const stderr = data.stderr.replace(/\r\n/g, '\n').trim();
    if (data.ok) showSuccess(stdout);
    else showError(stderr || 'The compiler stopped without a message.');
  } catch {
    resetResults("Couldn't reach the server. Check the connection and try again.");
    status.className = 'status error';
  } finally {
    runButton.removeAttribute('aria-busy');
  }
}

function loadExample(name) {
  source.value = EXAMPLES[name];
  resetResults('Run a program to see the result.');
  source.focus();
}

document.querySelectorAll('[data-example]').forEach((button) => {
  button.addEventListener('click', () => loadExample(button.dataset.example));
});
runButton.addEventListener('click', run);
source.addEventListener('input', () => {
  errorLine = null;
  updateGutter();
});
source.addEventListener('scroll', () => { gutter.scrollTop = source.scrollTop; });
source.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    run();
  }
});

source.value = EXAMPLES.percentage;
updateGutter();
