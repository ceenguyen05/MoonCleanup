import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The global focus ring (an ID selector) must skip script-focused headings: a module-level `.title:focus-visible`
// can never out-rank `#mc-ui :focus-visible`, which drew a teal box around "Which copy?". And the save prompt keeps its
// way out on screen: only the body scrolls, the foot (Decide later + key hints) is pinned outside the scroller.

/** Flat rule blocks (selector + body), comments removed; at-rule wrappers are ignored (inner rules still match). */
function ruleBlocks(css: string): { selector: string; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) out.push({ selector: m[1]!.trim(), body: m[2]! });
  return out;
}

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("focus ring and prompt layout (CSS)", () => {
  it("the global focus ring excludes headings", () => {
    const rule = ruleBlocks(read("./tokens/tokens.css")).find((b) => b.selector.startsWith("#mc-ui :focus-visible"));
    expect(rule).toBeDefined();
    expect(rule!.selector).toMatch(/:not\(\s*h1,\s*h2,\s*h3/);
    expect(rule!.body).toMatch(/outline:/);
  });

  it("the save prompt panel never scrolls; its body does, and the foot sits outside the scroller", () => {
    const blocks = ruleBlocks(read("./save/SaveConflictPrompt.module.css"));
    const body = (sel: string): string => blocks.find((b) => b.selector === sel)?.body ?? "";
    expect(body(".panel")).toMatch(/overflow:\s*hidden/);
    expect(body(".body")).toMatch(/overflow-y:\s*auto/);
    expect(body(".body")).toMatch(/min-height:\s*0/);
    expect(body(".foot")).not.toMatch(/overflow/);
    const tsx = read("./save/SaveConflictPrompt.tsx");
    expect(tsx.indexOf('styles["foot"]')).toBeGreaterThan(tsx.indexOf("</div>\n          <footer") - 1);
    expect(tsx).toMatch(/<\/div>\s*<footer className=\{styles\["foot"\]\}>/);
  });
});
