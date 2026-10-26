import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as indexExports from './index';
import * as ts from 'typescript';

const readSource = (file: string) => ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, file), 'utf8'), ts.ScriptTarget.Latest, true);
function walk(node: ts.Node, visitor: (node: ts.Node) => void): void { visitor(node); node.forEachChild(child => walk(child, visitor)); }
function imports(file: string): string[] {
  return readSource(file).statements.filter(ts.isImportDeclaration).map(s => (s.moduleSpecifier as ts.StringLiteral).text);
}

describe('System Isolation & Security Guardrails', () => {
  it('requires explicit review when a new Functions source module is added', () => {
    const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.sort()).toEqual([
      'adminNames.ts',
      'authValidation.ts',
      'businessDayServer.ts',
      'customerCreditReconciliation.ts',
      'expenses.ts',
      'financialContracts.ts',
      'financialPolicy.ts',
      'index.ts',
      'orderEvidence.ts',
      'payments.ts',
      'proportionalPaymentAllocation.ts',
    ].sort());
  });
  it('does not export any deletion endpoint in index.ts', () => {
    const exportedNames = Object.keys(indexExports);
    expect(exportedNames.sort()).toEqual([
      'FUNCTION_OPTIONS',
      'FUNCTION_REGION',
      'correctPayment',
      'manageAdminName',
      'recordExpense',
      'recordPayment',
      'updateExpense',
      'voidExpense',
    ].sort());
    expect(exportedNames).toContain('recordExpense');
    expect(exportedNames).toContain('updateExpense');
    expect(exportedNames).toContain('voidExpense');
    expect(exportedNames).toContain('manageAdminName');
    expect(exportedNames).toContain('recordPayment');
    expect(exportedNames).toContain('correctPayment');

    // Strict zero deletion check
    const deleteFunctions = exportedNames.filter((name) =>
      name.toLowerCase().includes('delete') || name.toLowerCase().includes('remove')
    );
    expect(deleteFunctions).toEqual([]);
  });

  it('keeps the exported expense dependency graph isolated from financial modules', () => {
    const files = ['index.ts', 'expenses.ts', 'adminNames.ts', 'authValidation.ts', 'businessDayServer.ts'];
    const allowedImports = new Set([
      'firebase-admin',
      'firebase-functions/v2/https',
      './authValidation',
      './expenses',
      './adminNames',
      './businessDayServer',
      './payments',
    ]);
    for (const file of files) {
      for (const dependency of imports(file)) expect(allowedImports.has(dependency), `${file}: unexpected import ${dependency}`).toBe(true);
    }

    const forbiddenTerms = [
      'collection(\'payments\')',
      'collection("payments")',
      'collection(\'ledger\')',
      'collection("ledger")',
      'collection(\'orders\')',
      'collection("orders")',
      'collection(\'products\')',
      'collection("products")',
      'collection(\'production\')',
      'collection("production")',
      'collection(\'clients\')',
      'collection("clients")',
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(__dirname, file), 'utf-8');
      for (const term of forbiddenTerms) {
        expect(
          content.includes(term),
          `Security violation: ${file} accesses forbidden collection "${term}"`
        ).toBe(false);
      }
    }
  });

  it('restricts expense modules to their original collections', () => {
    const files = ['index.ts', 'expenses.ts', 'adminNames.ts', 'authValidation.ts', 'businessDayServer.ts'];

    const collectionCalls: string[] = [];
    // Matches collection('...') or collection(CONSTANT)
    const literalRegex = /collection\(['"]([^'"]+)['"]\)/g;
    const constantRegex = /collection\(([A-Z_]+)\)/g;

    for (const file of files) {
      const content = fs.readFileSync(path.join(__dirname, file), 'utf-8');
      let match;
      while ((match = literalRegex.exec(content)) !== null) {
        collectionCalls.push(match[1]);
      }
      while ((match = constantRegex.exec(content)) !== null) {
        if (match[1] === 'ADMIN_NAMES_COLLECTION') collectionCalls.push('adminNames');
        if (match[1] === 'EXPENSES_COLLECTION') collectionCalls.push('expenses');
      }
    }

    const uniqueCollections = Array.from(new Set(collectionCalls));
    expect(uniqueCollections.sort()).toEqual(['adminNames', 'expenses', 'users'].sort());
  });

  it('keeps financial read services unregistered and structurally read-only', () => {
    const services = [
      { file: 'customerCreditReconciliation.ts', functionName: 'readTrustedCustomerCreditReview', collections: ['clientCreditBalances', 'clients', 'ledger', 'orders', 'payments'], dependencies: ['./authValidation', 'firebase-admin', 'firebase-functions/v2/https', 'node:crypto'] },
      { file: 'orderEvidence.ts', functionName: 'readOrderEvidence', collections: ['clientPricing', 'clients', 'finishedStockTransactions', 'products'], dependencies: ['./authValidation', './financialContracts', 'firebase-admin', 'firebase-functions/v2/https', 'node:crypto'] },
    ];
    for (const service of services) {
      expect(imports(service.file).sort()).toEqual(service.dependencies.sort());
      const source = readSource(service.file);
      const collections: string[] = [];
      let reader: ts.FunctionDeclaration | undefined;
      walk(source, node => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === service.functionName) reader = node;
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new Error(`${service.file}: dynamic imports are forbidden`);
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          if (['set', 'create', 'update', 'delete', 'add', 'batch', 'bulkWriter', 'commit', 'recursiveDelete'].includes(method)) {
            const receiver = node.expression.expression.getText(source);
            const allowed = (method === 'add' && ['ids', 'keys'].includes(receiver)) || (method === 'set' && receiver === 'paymentEntries') || (method === 'update' && receiver === "createHash('sha256')");
            expect(allowed, `${service.file}: unexpected ${receiver}.${method} call`).toBe(true);
          }
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'collection') {
          expect(node.arguments.length).toBe(1);
          expect(ts.isStringLiteral(node.arguments[0])).toBe(true);
          if (ts.isStringLiteral(node.arguments[0])) collections.push(node.arguments[0].text);
        }
      });
      expect(collections.sort()).toEqual(service.collections.sort());
      expect(reader).toBeDefined();
      const calls: string[] = [];
      let readOnly = false;
      walk(reader!, node => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) calls.push(node.expression.name.text);
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'readOnly' && node.initializer.kind === ts.SyntaxKind.TrueKeyword) readOnly = true;
      });
      expect(readOnly).toBe(true);
      expect(calls).toContain('runTransaction');
      for (const forbidden of ['set', 'create', 'update', 'delete', 'add', 'batch', 'bulkWriter', 'commit', 'recursiveDelete']) expect(calls).not.toContain(forbidden);
    }
  });
  it('keeps financial policy modules pure and free of Firestore access', () => {
    for (const file of ['financialContracts.ts', 'financialPolicy.ts', 'proportionalPaymentAllocation.ts']) {
      expect(imports(file).every(name => name === './financialContracts')).toBe(true);
      walk(readSource(file), node => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new Error(`${file}: dynamic import`);
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) expect(['collection', 'doc', 'runTransaction', 'batch', 'bulkWriter', 'commit'].includes(node.expression.name.text)).toBe(false);
      });
    }
  });
});
