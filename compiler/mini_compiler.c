#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdarg.h>
#include <limits.h>
#include <float.h>
#include <math.h>
#include <errno.h>

#define MAX_SOURCE 16000
#define MAX_VARS 50
#define MAX_CODE 500
#define NAME_SIZE 64

enum { END, ID = 256, NUMBER, INT, FLOAT, PRINT };
enum { INT_TYPE, FLOAT_TYPE };
enum { CONSTANT, VARIABLE, TEMPORARY };

typedef struct {
    int kind, type, line;
    char text[NAME_SIZE];
    double value;
} Token;

typedef struct {
    char name[NAME_SIZE];
    int type, initialized;
    double value;
} Variable;

typedef struct {
    int kind, type, index;
    char name[NAME_SIZE];
    double value;
} Operand;

typedef struct {
    char op;
    Operand left, right, result;
    int line;
} Instruction;

char source[MAX_SOURCE];
int pos, line = 1, varCount, codeCount, tempCount, depth;
Token token;
Variable variables[MAX_VARS];
Instruction code[MAX_CODE];
double tempValues[MAX_CODE], printValues[MAX_CODE];

void error(int atLine, const char *message, ...)
{
    va_list args;
    fprintf(stderr, "Error on line %d: ", atLine);
    va_start(args, message);
    vfprintf(stderr, message, args);
    va_end(args);
    fprintf(stderr, "\n");
    exit(1);
}

void nextToken(void)
{
    int start, length;
    for (;;) {
        while (isspace((unsigned char)source[pos])) {
            if (source[pos] == '\n') line++;
            pos++;
        }
        if (source[pos] != '/' || source[pos + 1] != '/') break;
        while (source[pos] && source[pos] != '\n') pos++;
    }
    token.line = line;
    start = pos;
    if (!source[pos]) {
        token.kind = END;
        strcpy(token.text, "end of file");
        return;
    }
    if (isalpha((unsigned char)source[pos])) {
        while (isalnum((unsigned char)source[pos])) pos++;
        token.kind = ID;
    } else if (isdigit((unsigned char)source[pos]) ||
               (source[pos] == '.' && isdigit((unsigned char)source[pos + 1]))) {
        token.type = INT_TYPE;
        while (isdigit((unsigned char)source[pos])) pos++;
        if (source[pos] == '.') {
            token.type = FLOAT_TYPE;
            pos++;
            while (isdigit((unsigned char)source[pos])) pos++;
        }
        token.kind = NUMBER;
    } else {
        if (!strchr("+-*/()=;", source[pos]))
            error(line, "unexpected character '%c'.", source[pos]);
        token.kind = (unsigned char)source[pos++];
    }
    length = pos - start;
    if (length >= NAME_SIZE) error(line, "name or number is too long.");
    memcpy(token.text, source + start, length);
    token.text[length] = '\0';
    if (token.kind == ID) {
        if (!strcmp(token.text, "int")) token.kind = INT;
        else if (!strcmp(token.text, "float")) token.kind = FLOAT;
        else if (!strcmp(token.text, "print")) token.kind = PRINT;
    } else if (token.kind == NUMBER) {
        errno = 0;
        token.value = strtod(token.text, NULL);
        if (errno == ERANGE || !isfinite(token.value) ||
            token.value > (token.type == INT_TYPE ? (double)INT_MAX : (double)FLT_MAX))
            error(line, "number is outside the supported range.");
        if (token.type == FLOAT_TYPE) token.value = (float)token.value;
    }
}

void match(int expected, const char *description)
{
    if (token.kind != expected)
        error(token.line, "expected %s, found '%s'.", description, token.text);
    nextToken();
}

int findVariable(const char *name)
{
    int i;
    for (i = 0; i < varCount; i++)
        if (!strcmp(name, variables[i].name)) return i;
    return -1;
}

Operand variableOperand(int index)
{
    Operand value = {0};
    value.kind = VARIABLE;
    value.type = variables[index].type;
    value.index = index;
    strcpy(value.name, variables[index].name);
    return value;
}

Operand newTemp(int type)
{
    Operand value = {0};
    if (tempCount >= MAX_CODE) error(token.line, "too many temporary values.");
    value.kind = TEMPORARY;
    value.type = type;
    value.index = tempCount++;
    /* Input names start with a letter, so these names cannot clash. */
    snprintf(value.name, NAME_SIZE, "_t%d", tempCount);
    return value;
}

void emit(char op, Operand left, Operand right, Operand result, int atLine)
{
    if (codeCount >= MAX_CODE) error(atLine, "program has too many instructions.");
    code[codeCount++] = (Instruction){op, left, right, result, atLine};
}

Operand toFloat(Operand value, int atLine)
{
    Operand result, unused = {0};
    if (value.type == FLOAT_TYPE) return value;
    result = newTemp(FLOAT_TYPE);
    emit('c', value, unused, result, atLine);
    return result;
}

Operand binary(char op, Operand left, Operand right, int atLine)
{
    Operand result;
    int type = INT_TYPE;
    if (left.type == FLOAT_TYPE || right.type == FLOAT_TYPE) {
        type = FLOAT_TYPE;
        left = toFloat(left, atLine);
        right = toFloat(right, atLine);
    }
    result = newTemp(type);
    emit(op, left, right, result, atLine);
    return result;
}

Operand expression(void);

Operand factor(void)
{
    Operand value = {0}, zero = {0};
    int index, sign, atLine = token.line;
    if (++depth > 64) error(atLine, "expression is nested too deeply.");
    if (token.kind == NUMBER) {
        value.kind = CONSTANT;
        value.type = token.type;
        value.value = token.value;
        strcpy(value.name, token.text);
        nextToken();
    } else if (token.kind == ID) {
        index = findVariable(token.text);
        if (index < 0) error(atLine, "'%s' is not declared.", token.text);
        if (!variables[index].initialized)
            error(atLine, "'%s' has no value yet.", token.text);
        value = variableOperand(index);
        nextToken();
    } else if (token.kind == '(') {
        nextToken();
        value = expression();
        match(')', "')'");
    } else if (token.kind == '+' || token.kind == '-') {
        sign = token.kind;
        nextToken();
        value = factor();
        strcpy(zero.name, "0");
        if (sign == '-') value = binary('-', zero, value, atLine);
    } else {
        error(atLine, "expected a number, variable or '('.");
    }
    depth--;
    return value;
}

Operand term(void)
{
    Operand left = factor(), right;
    int op, atLine;
    while (token.kind == '*' || token.kind == '/') {
        op = token.kind;
        atLine = token.line;
        nextToken();
        right = factor();
        left = binary((char)op, left, right, atLine);
    }
    return left;
}

Operand expression(void)
{
    Operand left = term(), right;
    int op, atLine;
    while (token.kind == '+' || token.kind == '-') {
        op = token.kind;
        atLine = token.line;
        nextToken();
        right = term();
        left = binary((char)op, left, right, atLine);
    }
    return left;
}

void statement(void)
{
    Operand value, target, unused = {0};
    int type, index, atLine = token.line;
    char name[NAME_SIZE];
    if (token.kind == INT || token.kind == FLOAT) {
        type = token.kind == INT ? INT_TYPE : FLOAT_TYPE;
        nextToken();
        if (token.kind != ID) error(token.line, "expected a variable name.");
        strcpy(name, token.text);
        if (findVariable(name) >= 0) error(atLine, "'%s' is already declared.", name);
        if (varCount == MAX_VARS) error(atLine, "too many variables.");
        nextToken();
        match(';', "';'");
        strcpy(variables[varCount].name, name);
        variables[varCount++].type = type;
    } else if (token.kind == PRINT) {
        nextToken();
        value = expression();
        match(';', "';'");
        emit('p', value, unused, unused, atLine);
    } else if (token.kind == ID) {
        index = findVariable(token.text);
        if (index < 0) error(atLine, "'%s' is not declared.", token.text);
        target = variableOperand(index);
        nextToken();
        match('=', "'='");
        value = expression();
        match(';', "';'");
        if (target.type == INT_TYPE && value.type == FLOAT_TYPE)
            error(atLine, "cannot assign a float value to int variable '%s'.", target.name);
        if (target.type == FLOAT_TYPE) value = toFloat(value, atLine);
        emit('=', value, unused, target, atLine);
        variables[index].initialized = 1;
    } else {
        error(atLine, "expected a declaration, assignment or print statement.");
    }
}

double getValue(Operand value)
{
    if (value.kind == VARIABLE) return variables[value.index].value;
    if (value.kind == TEMPORARY) return tempValues[value.index];
    return value.value;
}

void execute(void)
{
    int i;
    double left, right, result;
    for (i = 0; i < codeCount; i++) {
        Instruction item = code[i];
        left = getValue(item.left);
        right = getValue(item.right);
        result = left;
        switch (item.op) {
            case '+': result = left + right; break;
            case '-': result = left - right; break;
            case '*': result = left * right; break;
            case '/':
                if (right == 0) error(item.line, "division by zero.");
                result = left / right;
                break;
            case 'p':
                printValues[i] = left;
                continue;
        }
        if (!isfinite(result)) error(item.line, "numeric result is too large.");
        if (item.result.type == INT_TYPE) {
            if (result < INT_MIN || result > INT_MAX)
                error(item.line, "integer result is outside the supported range.");
            result = (int)result;
        } else {
            if (result < -FLT_MAX || result > FLT_MAX)
                error(item.line, "float result is outside the supported range.");
            result = (float)result;
        }
        if (item.result.kind == VARIABLE)
            variables[item.result.index].value = result;
        else
            tempValues[item.result.index] = result;
    }
}

void showOutput(void)
{
    int i, printed = 0;
    puts("Compilation successful.\n\nThree-address code:");
    for (i = 0; i < codeCount; i++) {
        Instruction item = code[i];
        if (item.op == '=')
            printf("%s = %s\n", item.result.name, item.left.name);
        else if (item.op == 'c')
            printf("%s = inttofloat(%s)\n", item.result.name, item.left.name);
        else if (item.op == 'p')
            printf("print %s\n", item.left.name);
        else
            printf("%s = %s %c %s\n", item.result.name,
                   item.left.name, item.op, item.right.name);
    }
    puts("\nProgram output:");
    for (i = 0; i < codeCount; i++) {
        if (code[i].op != 'p') continue;
        printed = 1;
        printf("%s = ", code[i].left.name);
        if (code[i].left.type == INT_TYPE) printf("%.0f\n", printValues[i]);
        else printf("%.2f\n", printValues[i]);
    }
    if (!printed) puts("No print statements.");
}

int main(int argc, char *argv[])
{
    FILE *file;
    size_t length;
    if (argc != 2) {
        puts("Usage: mini_compiler source.txt");
        return 1;
    }
    file = fopen(argv[1], "rb");
    if (!file) {
        fprintf(stderr, "Cannot open source file: %s\n", argv[1]);
        return 1;
    }
    length = fread(source, 1, MAX_SOURCE - 1, file);
    if (ferror(file) || fgetc(file) != EOF) {
        fclose(file);
        fprintf(stderr, "Cannot read source file or file is too large.\n");
        return 1;
    }
    fclose(file);
    source[length] = '\0';
    if (memchr(source, '\0', length)) error(1, "source contains a null character.");
    nextToken();
    if (token.kind == END) error(1, "source file is empty.");
    while (token.kind != END) statement();
    execute();
    showOutput();
    return 0;
}
