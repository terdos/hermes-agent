import { describe, expect, it } from "vitest";
import { buildBootstrapScript } from "./bootstrapScript";
import { BUILTIN_THEMES, defaultTheme } from "./presets";
import { FONT_CHOICES, THEME_DEFAULT_FONT_ID } from "./fonts";
import {
  THEME_STORAGE_KEY,
  FONT_STORAGE_KEY,
  themeVars,
} from "./themeVars";

/**
 * `buildBootstrapScript()` is the text inlined into `<head>` before first
 * paint (see `vite.config.ts`). The tests below assert the properties that
 * keep it safe and effective without a DOM:
 *
 *  - it is valid JavaScript (compiles under `new Function`),
 *  - it cannot terminate the host `<script>` tag,
 *  - it embeds every built-in theme with the SAME variable map the runtime
 *    provider applies (byte-identical → mount re-application is a no-op),
 *  - it reads the server-injected active theme with a localStorage fallback,
 *  - it knows the persistence keys the provider writes.
 *
 * The script is executed against a tiny stub DOM: `new Function("document",
 * "window", …)` injects the stubs as parameters, so no global mutation is
 * needed. Each test captures the `setProperty` calls the script makes.
 */

interface StubElement {
  setAttribute: (name: string, value: string) => void;
  rel?: string;
  href?: string;
}

interface StubStyle {
  setProperty: (name: string, value: string) => void;
}

interface StubDocument {
  documentElement: { style: StubStyle; dataset: Record<string, string> };
  head: { appendChild: (el: StubElement) => void };
  createElement: () => StubElement;
  querySelector: (selector: string) => StubElement | null;
}

interface StubWindow {
  __HERMES_ACTIVE_THEME__?: string;
  localStorage: { getItem: (key: string) => string | null };
}

interface RunResult {
  applied: [string, string][];
  fontLinks: string[];
}

/** Build a stub DOM that records every `setProperty` + font `<link>` the
 *  bootstrap script issues. */
function makeStubs(storage: Record<string, string | null>, activeTheme?: string) {
  const result: RunResult = { applied: [], fontLinks: [] };
  const doc: StubDocument = {
    documentElement: {
      style: {
        setProperty: (k, v) => result.applied.push([k, v]),
      },
      dataset: {},
    },
    head: {
      appendChild: (el) => {
        if (el.href) result.fontLinks.push(el.href);
      },
    },
    createElement: () => ({ setAttribute: () => {} }),
    querySelector: () => null,
  };
  const win: StubWindow = {
    localStorage: {
      getItem: (key) => storage[key] ?? null,
    },
  };
  if (activeTheme !== undefined) {
    win.__HERMES_ACTIVE_THEME__ = activeTheme;
  }
  return { doc, win, result };
}

/** Execute the bootstrap IIFE against the given stubs. The stub's own
 *  `setProperty`/`appendChild` (wired by `makeStubs`) record the calls, so we
 *  must NOT override them here — we just run the IIFE and hand back the
 *  stub's recorded result. */
function runScript(
  doc: StubDocument,
  win: StubWindow,
  result: RunResult,
): RunResult {
  const runner = new Function(
    "document",
    "window",
    buildBootstrapScript(),
  );
  runner(doc, win);
  return result;
}

describe("buildBootstrapScript", () => {
  const script = buildBootstrapScript();

  it("is syntactically valid JavaScript", () => {
    // Compiles (does not execute) — catches template-literal/escaping bugs.
    expect(() => new Function(script)).not.toThrow();
  });

  it("cannot break out of the host <script> tag", () => {
    // The only dangerous sequence in an inline script is a literal
    // `</script` (case-insensitive) — that is what terminates the host tag.
    // jsStr() encodes every `<` in embedded data as \u003c, so none of the
    // theme/font values can contribute one. (Comparison operators like
    // `f<FONTS.length` in the hand-written IIFE are fine and expected.)
    expect(script).not.toMatch(/<\/script/i);
    // No `</` sequence inside the serialized data either.
    expect(script).not.toMatch(/"\u003c\//);
  });

  it("embeds every built-in theme keyed by name", () => {
    for (const theme of Object.values(BUILTIN_THEMES)) {
      // The name appears as a THEMES record key.
      expect(script).toContain(`"${theme.name}"`);
    }
    // Default theme name is the fallback.
    expect(script).toContain(defaultTheme.name);
  });

  it("ships a variable map identical to themeVars() per built-in theme", () => {
    const { doc, win, result } = makeStubs(
      { [THEME_STORAGE_KEY]: "nous-blue" },
    );
    runScript(doc, win, result);
    const expected = themeVars(BUILTIN_THEMES["nous-blue"]);
    const got = Object.fromEntries(result.applied);
    // Every var themeVars() computes for the active (nous-blue) theme is set
    // by the pre-paint script, with the same value.
    for (const [k, v] of Object.entries(expected)) {
      expect(got[k], `missing/changed var ${k}`).toBe(v);
    }
    // Terminal colors + layout variant are applied by applyTheme() too.
    expect(got["--theme-terminal-background"]).toBe("#f5f8fc");
    expect(got["--theme-terminal-foreground"]).toBe("#170d02");
    expect(doc.documentElement.dataset.layoutVariant).toBe("standard");
  });

  it("prefers the server-injected active theme over localStorage", () => {
    const { doc, win, result } = makeStubs(
      { [THEME_STORAGE_KEY]: "ember" },
      "midnight",
    );
    runScript(doc, win, result);
    const got = Object.fromEntries(result.applied);
    // Midnight's canvas, not ember's.
    expect(got["--background-base"]).toBe("#0a0a1f");
    expect(got["--background-base"]).not.toBe("#1a0a06");
  });

  it("leaves the canvas alone for non-built-in (user) themes", () => {
    const { doc, win, result } = makeStubs(
      { [THEME_STORAGE_KEY]: "boring-dark" },
    );
    runScript(doc, win, result);
    // User themes are painted by the server's critical-CSS shim; the inline
    // script must not override the canvas with a built-in palette.
    expect(result.applied).toHaveLength(0);
  });

  it("applies an independent font override on top of the theme font", () => {
    const { doc, win, result } = makeStubs({
      [THEME_STORAGE_KEY]: "midnight",
      [FONT_STORAGE_KEY]: "spectral",
    });
    runScript(doc, win, result);
    const got = Object.fromEntries(result.applied);
    const spectral = FONT_CHOICES.find((f) => f.id === "spectral")!;
    // The override wins over the theme's own font stack.
    expect(got["--theme-font-sans"]).toBe(spectral.stack);
    expect(got["--theme-font-display"]).toBe(spectral.stack);
    expect(got["--theme-font-override-sans"]).toBe(spectral.stack);
    // The theme's own webfont (JetBrains Mono/Inter) is NOT the override's.
    expect(got["--theme-font-sans"]).not.toBe(
      themeVars(BUILTIN_THEMES.midnight)["--theme-font-sans"],
    );
  });

  it("defaults to the default theme and no font override when storage is empty", () => {
    const { doc, win, result } = makeStubs({});
    runScript(doc, win, result);
    const got = Object.fromEntries(result.applied);
    const expected = themeVars(defaultTheme);
    for (const [k, v] of Object.entries(expected)) {
      expect(got[k], `missing/changed var ${k}`).toBe(v);
    }
    expect(got["--theme-font-override-sans"]).toBeUndefined();
    expect(THEME_DEFAULT_FONT_ID).toBe("theme");
  });

  it("uses the same persistence keys as the React provider", () => {
    expect(script).toContain(THEME_STORAGE_KEY);
    expect(script).toContain(FONT_STORAGE_KEY);
  });

  it("migrates renamed built-in theme names (lens-5i → nous-blue)", () => {
    const { doc, win, result } = makeStubs(
      { [THEME_STORAGE_KEY]: "lens-5i" },
    );
    runScript(doc, win, result);
    const got = Object.fromEntries(result.applied);
    // The stale name resolves to nous-blue's canvas, not the default teal.
    const expected = themeVars(BUILTIN_THEMES["nous-blue"]);
    expect(got["--background-base"]).toBe(expected["--background-base"]);
    expect(got["--midground-base"]).toBe(expected["--midground-base"]);
  });
});
