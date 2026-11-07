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
}

const MAX_TEXT = 200;

export function extract(tree: Tree): { imports: RawImport[]; facts: FileFacts } {
  const imports: RawImport[] = [];
  const facts: FileFacts = { mainGuard: false };
  const line = (n: Node) => n.startPosition.row + 1;
  const clip = (s: string) => s.replace(/\s+/g, " ").slice(0, MAX_TEXT);

  const visit = (n: Node, typeOnly: boolean) => {
    switch (n.type) {
      case "import_statement": {
        for (const name of n.childrenForFieldName("name")) {
          const dotted = name?.type === "aliased_import" ? name.childForFieldName("name") : name;
          if (dotted) imports.push({ specifier: dotted.text, kind: "import", typeOnly, line: line(n), literal: true });
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
          if (dotted) imports.push({ specifier: `from ${from} import ${dotted.text}`, kind: "import", typeOnly, line: line(n), literal: true });
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
      case "call": {
        const fn = n.childForFieldName("function")?.text ?? "";
        const args = n.childForFieldName("arguments");
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
