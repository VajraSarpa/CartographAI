import type { RawImport } from "cartograph-lang-api";
import type { Node, Tree } from "web-tree-sitter";

/**
 * Specifier forms this plug-in produces (and its resolver reads back):
 *   "a.b"                      import a.b
 *   "from a.b import c"        from a.b import c   (one record per imported name)
 *   "from .. import c"         relative
 *   "from a import *"
 *   'importlib.import_module("a.b")'   runtime import, never an edge
 *   'sys.path.insert(0, "lib")'        import-path change, never an edge
 */
export interface FileFacts {
  /** has `if __name__ == "__main__":` at module level */
  mainGuard: boolean;
  /** names bound by import statements, for following a name to the file that defines it */
  bindings: Binding[];
  /** `name = callee(args)` assignments (any scope) */
  assigns: { name: string; callee: string; args: Arg[]; line: number }[];
  /** decorators on functions: `@callee(args)`; line is the `def` line */
  decorators: { callee: string; args: Arg[]; line: number }[];
  /** calls whose callee ends in one of WATCHED_CALLS, e.g. `app.include_router(...)` */
  calls: { callee: string; args: Arg[]; line: number }[];
}

/** `import a.b as c` -> {local: "c", module: "a.b"}; `from m import x as y` -> {local: "y", spec: "from m import x", name: "x"} */
export type Binding = { local: string; module: string } | { local: string; spec: string; name: string };

/** One call argument, keeping only what can be read exactly: a plain string, or a list of plain strings. */
export interface Arg {
  kw: string | null;
  str?: string;
  list?: string[];
  /** a name or dotted name, e.g. `items.router` */
  ref?: string;
  /** the callee when the argument is itself a call, e.g. `StaticFiles` */
  call?: string;
}

const WATCHED_CALLS = /\.(include_router|register_blueprint|mount)$|^DispatcherMiddleware$/;

const MAX_TEXT = 200;

export function extract(tree: Tree): { imports: RawImport[]; facts: FileFacts } {
  const imports: RawImport[] = [];
  const facts: FileFacts = { mainGuard: false, bindings: [], assigns: [], decorators: [], calls: [] };
  const line = (n: Node) => n.startPosition.row + 1;
  const clip = (s: string) => s.replace(/\s+/g, " ").slice(0, MAX_TEXT);

  const visit = (n: Node, typeOnly: boolean) => {
    switch (n.type) {
      case "import_statement": {
        for (const name of n.childrenForFieldName("name")) {
          const dotted = name?.type === "aliased_import" ? name.childForFieldName("name") : name;
          if (!dotted) continue;
          imports.push({ specifier: dotted.text, kind: "import", typeOnly, line: line(n), literal: true });
          const alias = name?.type === "aliased_import" ? name.childForFieldName("alias")?.text : undefined;
          facts.bindings.push(alias ? { local: alias, module: dotted.text } : { local: dotted.text.split(".")[0], module: dotted.text });
        }
        return;
      }
      case "future_import_statement": {
        for (const name of n.childrenForFieldName("name")) {
          const dotted = name?.type === "aliased_import" ? name.childForFieldName("name") : name;
          if (dotted) imports.push({ specifier: `from __future__ import ${dotted.text}`, kind: "import", typeOnly: false, line: line(n), literal: true });
        }
        return;
      }
      case "import_from_statement": {
        const mod = n.childForFieldName("module_name");
        if (!mod) return;
        const from = mod.text.replace(/\s+/g, "");
        const names = n.childrenForFieldName("name");
        const star = n.children.some((c) => c?.type === "wildcard_import");
        if (star || names.length === 0) {
          imports.push({ specifier: `from ${from} import *`, kind: "import", typeOnly, line: line(n), literal: true });
          return;
        }
        for (const name of names) {
          const dotted = name?.type === "aliased_import" ? name.childForFieldName("name") : name;
          if (!dotted) continue;
          const spec = `from ${from} import ${dotted.text}`;
          imports.push({ specifier: spec, kind: "import", typeOnly, line: line(n), literal: true });
          const alias = name?.type === "aliased_import" ? name.childForFieldName("alias")?.text : undefined;
          facts.bindings.push({ local: alias ?? dotted.text, spec, name: dotted.text });
        }
        return;
      }
      case "if_statement": {
        const cond = n.childForFieldName("condition");
        const condText = cond?.text.replace(/\s+/g, "") ?? "";
        if (n.parent?.type === "module" && /^(__name__==["']__main__["']|["']__main__["']==__name__)$/.test(condText)) facts.mainGuard = true;
        const isTypeChecking = condText === "TYPE_CHECKING" || condText === "typing.TYPE_CHECKING";
        // tree-sitter hands out a fresh object per lookup: compare node ids, not objects
        const body = n.childForFieldName("consequence")?.id;
        for (const c of n.children) {
          if (!c) continue;
          // only the `if` body is type-only; elif/else branches run
          visit(c, typeOnly || (isTypeChecking && c.id === body));
        }
        return;
      }
      case "decorated_definition": {
        const def = n.childForFieldName("definition");
        if (def?.type === "function_definition") {
          for (const d of n.namedChildren) {
            if (d?.type !== "decorator") continue;
            const call = d.namedChildren.find((c) => c?.type === "call");
            if (call) facts.decorators.push({ callee: calleeText(call), args: readArgs(call), line: line(def) });
          }
        }
        break;
      }
      case "call": {
        const fn = n.childForFieldName("function")?.text ?? "";
        const args = n.childForFieldName("arguments");
        if (WATCHED_CALLS.test(fn.replace(/\s+/g, ""))) facts.calls.push({ callee: fn.replace(/\s+/g, ""), args: readArgs(n), line: line(n) });
        if (fn === "importlib.import_module" || fn === "import_module" || fn === "__import__") {
          const first = args?.namedChildren.find((c) => c && c.type !== "comment") ?? null;
          imports.push({ specifier: clip(n.text), kind: "dynamic", typeOnly: false, line: line(n), literal: isPlainString(first) });
        } else if (/^sys\.path\.(insert|append|extend)$/.test(fn) || fn === "site.addsitedir") {
          imports.push({ specifier: clip(n.text), kind: "dynamic", typeOnly: false, line: line(n), literal: true });
        }
        break;
      }
      case "assignment":
      case "augmented_assignment": {
        const left = n.childForFieldName("left")?.text.replace(/\s+/g, "") ?? "";
        const right = n.childForFieldName("right");
        if (n.type === "assignment" && right?.type === "call" && /^[A-Za-z_]\w*$/.test(left)) {
          facts.assigns.push({ name: left, callee: calleeText(right), args: readArgs(right), line: line(n) });
        }
        if (left === "sys.path" || left.startsWith("sys.path[")) {
          imports.push({ specifier: clip(n.text), kind: "dynamic", typeOnly: false, line: line(n), literal: true });
        }
        break;
      }
    }
    for (const c of n.children) if (c) visit(c, typeOnly);
  };
  visit(tree.rootNode, false);
  return { imports, facts };
}

/** a string literal with no interpolation (an f-string is computed) */
function isPlainString(n: Node | null): boolean {
  if (!n || n.type !== "string") return false;
  return !n.children.some((c) => c?.type === "interpolation") && !/^[a-zA-Z]*[fF]/.test(n.text);
}

function calleeText(call: Node): string {
  return (call.childForFieldName("function")?.text ?? "").replace(/\s+/g, "");
}

function plainString(n: Node | null | undefined): string | undefined {
  if (!n || !isPlainString(n)) return undefined;
  const content = n.children.filter((c) => c?.type === "string_content").map((c) => c!.text).join("");
  // a string with escapes or concatenation is not read
  if (n.children.some((c) => c?.type === "escape_sequence")) return undefined;
  return content;
}

function readArgs(call: Node): Arg[] {
  const out: Arg[] = [];
  const list = call.childForFieldName("arguments");
  for (const a of list?.namedChildren ?? []) {
    if (!a || a.type === "comment") continue;
    let kw: string | null = null;
    let v: Node | null = a;
    if (a.type === "keyword_argument") {
      kw = a.childForFieldName("name")?.text ?? null;
      v = a.childForFieldName("value");
    }
    const arg: Arg = { kw };
    const str = plainString(v);
    if (str !== undefined) arg.str = str;
    else if (v && (v.type === "identifier" || v.type === "attribute") && /^[\w.]+$/.test(v.text.replace(/\s+/g, ""))) arg.ref = v.text.replace(/\s+/g, "");
    else if (v?.type === "call") arg.call = calleeText(v);
    else if (v && (v.type === "list" || v.type === "tuple" || v.type === "set")) {
      const items = v.namedChildren.filter((c) => c && c.type !== "comment").map((c) => plainString(c));
      if (items.every((x): x is string => x !== undefined)) arg.list = items;
    }
    out.push(arg);
  }
  return out;
}
