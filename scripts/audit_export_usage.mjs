import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromWeb = createRequire(path.join(root, 'game-web/package.json'));
const ts = requireFromWeb('typescript');
const srcRoot = path.join(root, 'game-web/src');

function listSourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listSourceFiles(filename));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      result.push(filename);
    }
  }
  return result;
}

function targetFor(importer, specifier, known) {
  if (!specifier.startsWith('.')) return null;
  const absolute = path.resolve(path.dirname(importer), specifier);
  const stem = absolute.replace(/\.(?:js|jsx|ts|tsx|mjs)$/, '');
  return [absolute, stem + '.ts', stem + '.tsx', stem + '.mjs', stem + '.js',
    path.join(stem, 'index.ts')].find((entry) => known.has(entry)) ?? null;
}

function namedExports(source) {
  const candidates = [];
  for (const statement of source.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const names = [];
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name);
      }
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)) {
      if (statement.name) names.push(statement.name);
    }
    for (const name of names) {
      candidates.push({ name: name.text, declarationStart: name.getStart(source),
        line: source.getLineAndCharacterOfPosition(name.getStart(source)).line + 1 });
    }
  }
  return candidates;
}

/** Conservative import/re-export graph. A candidate is not proof that removal is safe. */
export function auditExportUsage(sources, sourceRoot) {
  const known = new Set(sources.keys());
  const parsed = new Map();
  const candidates = new Map();
  const used = new Map();
  for (const [filename, content] of sources) {
    const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true,
      filename.endsWith('.ts') || filename.endsWith('.tsx') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    parsed.set(filename, source);
    if (!filename.startsWith(sourceRoot + path.sep)) continue;
    const exports = namedExports(source);
    candidates.set(filename, exports);
    used.set(filename, new Set());
    // References inside the declaring module count too (even if imported nowhere).
    function visit(node) {
      if (ts.isIdentifier(node)) {
        for (const declaration of exports) {
          if (node.text === declaration.name && node.getStart(source) !== declaration.declarationStart) {
            used.get(filename).add(declaration.name);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const mark = (file, name) => {
    if (!used.has(file)) return;
    if (name === '*') {
      for (const entry of candidates.get(file)) used.get(file).add(entry.name);
    } else {
      used.get(file).add(name);
    }
  };
  for (const [filename, source] of parsed) {
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = targetFor(filename, statement.moduleSpecifier.text, known);
        if (!target) continue;
        const imports = statement.importClause;
        if (!imports) continue;
        if (imports.name) mark(target, 'default');
        if (imports.namedBindings) {
          if (ts.isNamespaceImport(imports.namedBindings)) mark(target, '*');
          else for (const element of imports.namedBindings.elements) {
            mark(target, (element.propertyName ?? element.name).text);
          }
        }
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier
        && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = targetFor(filename, statement.moduleSpecifier.text, known);
        if (!target) continue;
        if (!statement.exportClause || ts.isNamespaceExport(statement.exportClause)) mark(target, '*');
        else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            mark(target, (element.propertyName ?? element.name).text);
          }
        }
      }
    }
    // Literal dynamic imports and require() can expose arbitrary properties.
    function dynamicVisit(node) {
      if (ts.isCallExpression(node) && node.arguments.length === 1
        && ts.isStringLiteral(node.arguments[0])
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const target = targetFor(filename, node.arguments[0].text, known);
        if (target) mark(target, '*');
      }
      ts.forEachChild(node, dynamicVisit);
    }
    dynamicVisit(source);
  }
  const unused = [];
  for (const [filename, exports] of candidates) {
    for (const exported of exports) {
      if (!used.get(filename).has(exported.name)) {
        unused.push({ file: path.relative(sourceRoot, filename).replaceAll('\\', '/'),
          name: exported.name, line: exported.line });
      }
    }
  }
  return unused.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = [...new Set([
    ...listSourceFiles(srcRoot),
    ...listSourceFiles(path.join(root, 'game-web/scripts')),
    ...listSourceFiles(path.join(root, 'tests')),
    ...listSourceFiles(path.join(root, 'gone-host')),
    path.join(root, 'game-web/vite.config.ts'),
  ])].filter((filename) => fs.existsSync(filename));
  const sources = new Map(files.map((filename) => [filename, fs.readFileSync(filename, 'utf8')]));
  const findings = auditExportUsage(sources, srcRoot);
  console.log('[unused-exports] ' + findings.length + ' potential unused named exports (advisory; never auto-delete browser APIs).');
  for (const finding of findings.slice(0, 40)) {
    console.log('  ' + finding.file + ':' + finding.line + ' ' + finding.name);
  }
  if (findings.length > 40) console.log('  ... see the complete report artifact');
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]),
    JSON.stringify({ sourceModules: listSourceFiles(srcRoot).length, findings }, null, 2) + '\n');
}
