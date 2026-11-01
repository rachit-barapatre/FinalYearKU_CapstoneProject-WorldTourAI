
%{
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int yylex(void);
void yyerror(const char *s);

struct Symbol {
    char name[100];
    double value;
};

struct Symbol table[100];
int count = 0;

int lookup(char *name) {
    for (int i = 0; i < count; i++) {
        if (strcmp(table[i].name, name) == 0)
            return i;
    }
    return -1;
}

double getval(char *name) {
    int i = lookup(name);

    if (i == -1) {
        printf("Error: Undefined identifier %s\n", name);
        return 0;
    }

    return table[i].value;
}

void setval(char *name, double value) {
    int i = lookup(name);

    if (i == -1) {
        if (count >= 100) {
            printf("Symbol table is full\n");
            return;
        }

        i = count++;
        strcpy(table[i].name, name);
    }

    table[i].value = value;
}

void print_table(void) {
    printf("\nSymbol Table\n");
    printf("----------------------\n");
    printf("%-15s %s\n", "Name", "Value");
    printf("----------------------\n");

    for (int i = 0; i < count; i++)
        printf("%-15s %.2f\n",
               table[i].name, table[i].value);
}
%}

%union {
    double num;
    char *id;
}

%token <num> NUMBER
%token <id> ID
%type <num> expr

%left '+' '-'
%left '*' '/'
%right UMINUS

%%

program:
      /* empty */
    | program statement
    ;

statement:
      ID '=' expr '\n'
        {
            setval($1, $3);
            printf("%s = %.2f\n", $1, $3);
            free($1);
        }
    | expr '\n'
        {
            printf("Result = %.2f\n", $1);
        }
    ;

expr:
      NUMBER
        { $$ = $1; }
    | ID
        {
            $$ = getval($1);
            free($1);
        }
    | expr '+' expr
        { $$ = $1 + $3; }
    | expr '-' expr
        { $$ = $1 - $3; }
    | expr '*' expr
        { $$ = $1 * $3; }
    | expr '/' expr
        {
            if ($3 == 0) {
                yyerror("Division by zero");
                YYABORT;
            }
            $$ = $1 / $3;
        }
    | '-' expr %prec UMINUS
        { $$ = -$2; }
    | '(' expr ')'
        { $$ = $2; }
    ;

%%

void yyerror(const char *s) {
    fprintf(stderr, "Error: %s\n", s);
}

int main(void) {
    printf("Enter expressions or assignments, one per line.\n");
    printf("Press Ctrl+D to finish input.\n\n");

    yyparse();
    print_table();

    return 0;
}