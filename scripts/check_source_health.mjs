import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'game-web', 'src');
// Use the same TypeScript compiler already locked for the browser build.
const requireFromWeb = createRequire(path.join(root, 'game-web', 'package.json'));
const ts = requireFromWeb('typescript');
const MAIN = 'main.ts';

export function collectRelativeDependencies(sourceFile) {
  const dependencies = [];
  function add(specifier) {
    if (typeof specifier === 'string' && specifier.startsWith('.')) {
      dependencies.push(specifier);
    }
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
               node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...new Set(dependencies)];
}

export function unsafeSourcePatterns(sourceFile) {
  const problems = [];
  const patchedProtoAliases = new Set();
  // Reject runtime patches against protocol owners, including aliases of their prototypes.
  function isProtocolPrototype(node) {
    return ts.isPropertyAccessExpression(node)
      && node.name.text === 'prototype'
      && ts.isIdentifier(node.expression)
      && (node.expression.text === 'P2PHost' || node.expression.text === 'P2PClient');
  }
  function collectAliases(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (isProtocolPrototype(node.initializer)
        || (ts.isAsExpression(node.initializer) && isProtocolPrototype(node.initializer.expression)))) {
      patchedProtoAliases.add(node.name.text);
    }
    ts.forEachChild(node, collectAliases);
  }
  collectAliases(sourceFile);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') {
      problems.push('dynamic eval is forbidden');
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
      problems.push('dynamic Function constructor is forbidden');
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const receiver = ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)
        ? node.left.expression : null;
      if (receiver && (isProtocolPrototype(receiver)
        || (ts.isIdentifier(receiver) && patchedProtoAliases.has(receiver.text)))) {
        problems.push('protocol prototype method replacement is forbidden');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return problems;
}

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(abs));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      result.push(abs);
    }
  }
  return result;
}

function normalizeSpecifier(importer, specifier, known) {
  const base = path.resolve(path.dirname(importer), specifier);
  const withoutJs = base.replace(/\.jsx?$/, '');
  const options = [base, withoutJs + '.ts', withoutJs + '.tsx', path.join(withoutJs, 'index.ts')];
  return options.find((candidate) => known.has(candidate));
}

export function findUnreachableModules(graph, roots) {
  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
  }
  for (const root of roots) visit(root);
  return [...graph.keys()].filter((file) => !visited.has(file)).sort();
}

export function checkSourceHealth(sourceRoot = srcRoot) {
  const files = walk(sourceRoot);
  const known = new Set(files);
  const graph = new Map();
  const failures = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const relativePath = path.relative(sourceRoot, file).replaceAll('\\', '/');
    for (const issue of unsafeSourcePatterns(parsed)) failures.push(relativePath + ': ' + issue);
    const imports = collectRelativeDependencies(parsed);
    const dependencies = [];
    for (const specifier of imports) {
      if (!/\.(?:ts|tsx|js|jsx)?$/.test(specifier) && specifier.endsWith('.css')) continue;
      const resolved = normalizeSpecifier(file, specifier, known);
      if (resolved) dependencies.push(resolved);
      // Missing imports are diagnosed by the mandatory TypeScript build.
    }
    graph.set(file, dependencies);
    if (relativePath === MAIN && /\(window as any\)\.gone/.test(source)) {
      failures.push('main.ts: runtime composition must never read compatibility globals');
    }
  }

  const main = path.join(sourceRoot, MAIN);
  if (!known.has(main)) failures.push('Missing main.ts source entrypoint');
  const unreachable = findUnreachableModules(graph, known.has(main) ? [main] : []);
  if (unreachable.length > 0) {
    failures.push('Unreachable TypeScript modules (review/remove or explicitly import their owner):');
    for (const file of unreachable) failures.push('  ' + path.relative(sourceRoot, file).replaceAll('\\', '/'));
  }
  return { files: files.length, reachable: files.length - unreachable.length, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkSourceHealth();
  for (const failure of result.failures) console.error('[source-health] ' + failure);
  if (result.failures.length) process.exitCode = 1;
  else console.log('[source-health] PASS: ' + result.reachable + '/' + result.files + ' modules reachable, no forbidden dynamic execution or global composition coupling.');
}
