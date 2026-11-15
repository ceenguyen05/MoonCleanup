import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// VT-M0-10: a 1-device-pixel line must not be a solid `background` on a box whose width or height is the hairline.
// Chrome snaps that background rect to whole CSS px when the page DPR is emulated, leaving a faint second row
// (rows 247/96 at DPR 1, 247/101 at DPR 2). Use a box-shadow ring or a gradient hard stop at --mc-px instead.

const UI_DIR = fileURLToPath(new URL(".", import.meta.url));

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

/** Rule blocks (selector + body) of a flat CSS file; comments removed. */
export function ruleBlocks(css: string): { selector: string; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks: { selector: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) blocks.push({ selector: m[1]!.trim(), body: m[2]! });
  return blocks;
}

/** Selectors of blocks that size a box to exactly one device pixel AND paint it with a solid background. */
export function solidHairlineBoxes(css: string): string[] {
  const bad: string[] = [];
  for (const { selector, body } of ruleBlocks(css)) {
    const sized = /(^|;|\s)(width|height|min-width|min-height)\s*:\s*var\(--mc-(px|hairline)\)\s*(;|$)/.test(body);
    if (!sized) continue;
    const bg = /(^|;|\s)background(-color)?\s*:\s*([^;]+)/.exec(body);
    if (bg && !/gradient\(/.test(bg[3]!) && !/^\s*(transparent|none)\s*$/.test(bg[3]!)) bad.push(selector);
  }
  return bad;
}

describe("hairline rule (VT-M0-10)", () => {
  it("flags a solid background on a hairline-sized box", () => {
    expect(solidHairlineBoxes(".a { height: var(--mc-px); background: red; }")).toEqual([".a"]);
    expect(solidHairlineBoxes(".a { width: var(--mc-hairline); background-color: #fff; }")).toEqual([".a"]);
  });
  it("accepts gradient hard stops and ordinary boxes", () => {
    expect(
      solidHairlineBoxes(
        ".a { height: var(--mc-px); background: linear-gradient(red 0 var(--mc-px), transparent var(--mc-px)); }",
      ),
    ).toEqual([]);
    expect(solidHairlineBoxes(".a { height: 12px; background: red; }")).toEqual([]);
  });
  it("no UI stylesheet draws a hairline as a solid-background box", () => {
    const offenders = cssFiles(UI_DIR).flatMap((file) =>
      solidHairlineBoxes(readFileSync(file, "utf8")).map((sel) => `${file.slice(UI_DIR.length)}: ${sel}`),
    );
    expect(offenders).toEqual([]);
  });
});
