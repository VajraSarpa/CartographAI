import ts from "typescript";
import type { ImportKind } from "cartograph-lang-api";

export interface RawImport {
  specifier: string;
  kind: ImportKind;
  typeOnly: boolean;
  line: number;
  /** false when the specifier is computed at runtime and cannot be resolved */
  literal: boolean;
}

export function scriptKindFor(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/.test(path)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

export function parseSource(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path));
}

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Every import-like statement in a file, read from the real syntax tree. */
export function extractImports(sf: ts.SourceFile): RawImport[] {
  const out: RawImport[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const spec = literalText(node.moduleSpecifier);
      if (spec !== null) {
        const clause = node.importClause;
        let typeOnly = !!clause?.isTypeOnly;
        if (!typeOnly && clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          const els = clause.namedBindings.elements;
          typeOnly = els.length > 0 && els.every((e) => e.isTypeOnly);
        }
        out.push({ specifier: spec, kind: "import", typeOnly, line: lineOf(node), literal: true });
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      const spec = literalText(node.moduleSpecifier);
      if (spec !== null) out.push({ specifier: spec, kind: "reexport", typeOnly: node.isTypeOnly, line: lineOf(node), literal: true });
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const spec = literalText(node.moduleReference.expression);
      if (spec !== null) out.push({ specifier: spec, kind: "import-equals", typeOnly: node.isTypeOnly, line: lineOf(node), literal: true });
      return;
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const spec = literalText(node.argument.literal);
      if (spec !== null) out.push({ specifier: spec, kind: "import", typeOnly: true, line: lineOf(node), literal: true });
    }
    if (ts.isCallExpression(node)) {
      const isDynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments.length === 1;
      if (isDynamic || isRequire) {
        const arg = node.arguments[0];
        const spec = literalText(arg);
        out.push({
          specifier: spec ?? (arg ? arg.getText(sf).slice(0, 200) : ""),
          kind: isDynamic ? "dynamic" : "require",
          typeOnly: false,
          line: lineOf(node),
          literal: spec !== null,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export interface FileFacts {
  directive: "use client" | "use server" | null;
  /** names of exported values / functions / classes ("default" for default export) */
  exports: string[];
  hasJsx: boolean;
  createsContext: boolean;
  /** decorator names applied to classes, e.g. Controller, Injectable, Module */
  classDecorators: string[];
}

function hasExportModifier(n: ts.Node): boolean {
  const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}
function hasDefaultModifier(n: ts.Node): boolean {
  const mods = ts.canHaveModifiers(n) ? ts.getModifiers(n) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

export function decoratorName(d: ts.Decorator): string | null {
  const e = d.expression;
  if (ts.isCallExpression(e)) {
    if (ts.isIdentifier(e.expression)) return e.expression.text;
    if (ts.isPropertyAccessExpression(e.expression)) return e.expression.name.text;
  }
  if (ts.isIdentifier(e)) return e.text;
  return null;
}

/** Facts the framework adapters use. All read from syntax, nothing inferred. */
export function extractFacts(sf: ts.SourceFile): FileFacts {
  const facts: FileFacts = { directive: null, exports: [], hasJsx: false, createsContext: false, classDecorators: [] };
  const first = sf.statements[0];
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)) {
    const t = first.expression.text;
    if (t === "use client" || t === "use server") facts.directive = t;
  }
  for (const st of sf.statements) {
    if (!hasExportModifier(st)) {
      if (ts.isExportAssignment(st)) facts.exports.push("default");
      if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) facts.exports.push(el.name.text);
      }
      continue;
    }
    if (hasDefaultModifier(st)) facts.exports.push("default");
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) facts.exports.push(st.name.text);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) facts.exports.push(d.name.text);
    }
  }
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) facts.hasJsx = true;
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if ((ts.isIdentifier(c) && c.text === "createContext") || (ts.isPropertyAccessExpression(c) && c.name.text === "createContext")) {
        facts.createsContext = true;
      }
    }
    if (ts.isClassDeclaration(n)) {
      for (const d of ts.getDecorators(n) ?? []) {
        const name = decoratorName(d);
        if (name) facts.classDecorators.push(name);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return facts;
}
