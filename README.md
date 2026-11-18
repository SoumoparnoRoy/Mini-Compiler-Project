# Mini Compiler for Student Result Expressions

A small compiler written in C for a tiny language of `int` and `float` variables, arithmetic expressions and `print` statements. It recognises tokens, parses with recursive descent, keeps a symbol table, checks declarations and types, generates three-address code (TAC) and runs that code in a small interpreter. It does not produce machine code.

A web page lets you type a program, run it through the same C compiler and see the error, the TAC and the output.

## Example

```
int marks;
float percentage;
marks = 420;
percentage = (marks / 500.0) * 100;
print marks;
print percentage;
```

```
Three-address code:
marks = 420
_t1 = inttofloat(marks)
_t2 = _t1 / 500.0
_t3 = inttofloat(100)
_t4 = _t2 * _t3
percentage = _t4
print marks
print percentage

Program output:
marks = 420
percentage = 84.00
```

## Folder structure

```
compiler/
  mini_compiler.c        the compiler (single C file)
  examples/              sample programs, including two error cases
public/                  the web page (HTML, CSS, JavaScript)
api/run.js               Vercel function that runs the compiler
lib/run-compiler.js      writes the program to a temp file and runs the compiler on it
server.js                local server for the same page and API
bin/                     compiled compiler (the Linux build is used on Vercel)
tests/check-prototype.js 38 language checks plus server limit checks
```

## Run the compiler on its own

Needs GCC (on Windows, MSYS2 UCRT64).

```
gcc -std=c11 -Wall -Wextra compiler/mini_compiler.c -o mini_compiler
./mini_compiler compiler/examples/result.txt
```

## Run the website locally

Needs Node.js 20 or later. Build the Windows compiler into `bin/` first:

```
gcc -std=c11 -Wall -Wextra -O2 compiler/mini_compiler.c -o bin/mini_compiler.exe
npm start
```

Then open http://localhost:3000. In a second terminal, `npm test` sends every check through the site and compares the result with running the compiler directly.

## Deploying to Vercel

Vercel runs Linux, so it uses `bin/mini_compiler-linux`. After changing the C code, rebuild it with Docker:

```
docker run --rm -v "${PWD}:/src" -w /src gcc:14 gcc -std=c11 -O2 -static -s compiler/mini_compiler.c -o bin/mini_compiler-linux -lm
```

## How the website runs the compiler safely

- The page only sends the program text. The server writes it to a new temporary file with a random name and deletes it afterwards.
- The compiler is started directly with the file path as its only argument. No shell is used, so the program text can never be run as a command.
- Each run is limited to 2 seconds and 64 KB of output, and requests over 32,000 bytes are refused. The compiler itself accepts at most 15,999 bytes of source.

## Language

- Types: `int` and `float`. Declare first (`int marks;`), then assign (`marks = 420;`).
- Operators: `+ - * /`, brackets and unary signs, with the usual precedence and left associativity.
- `print` takes any expression. `//` starts a comment.
- Variables must be declared and given a value before use.
- Integer division drops the fraction. An `int` is widened to `float` when mixed with a `float`. Assigning a `float` to an `int` variable is an error.
- Not supported: strings, arrays, functions, loops and conditions.
