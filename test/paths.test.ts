import { describe, expect, it } from "vitest";
import { checkPaths, findPathMentions } from "@/lib/paths";

describe("path mentions", () => {
  const shown = ["src/lib/b.ts", "src/index.ts", "packages/x/src/types.ts"];
  it("finds backticked and bare paths", () => {
    expect(findPathMentions("It is imported by `src/index.ts` and src/lib/b.ts.")).toEqual(["src/index.ts", "src/lib/b.ts"]);
  });
  it("flags a path that was not shown", () => {
    expect(checkPaths("See `src/lib/secret.ts` for details.", shown).invented).toEqual(["src/lib/secret.ts"]);
  });
  it("a relative tail of another file is invented, not a match", () => {
    expect(checkPaths("Uses `lib/b.ts`.", shown).invented).toEqual(["lib/b.ts"]);
    expect(checkPaths("Uses `./types.ts`.", shown).invented).toEqual(["./types.ts"]);
  });
  it("ignores npm packages, urls and prose slashes", () => {
    expect(findPathMentions("Uses `react`, `@clerk/nextjs`, https://x.com/a/b and input/output.")).toEqual([]);
  });
  it("strips line suffixes and trailing punctuation", () => {
    expect(checkPaths("Defined in `packages/x/src/types.ts:42`.", shown).invented).toEqual([]);
  });
  it("catches paths hidden in code spans with other text", () => {
    expect(findPathMentions("Call `src/app/route.ts`")).toEqual(["src/app/route.ts"]);
  });
});
