/**
 * Build-time generator for the pre-paint theme bootstrap script.
 *
 * The returned string is inlined into `<head>` (see `vite.config.ts`) and runs
 * *before* React mounts. It reads the active theme name + font override from
 * localStorage, looks them up in the embedded built-in catalog, and writes the
 * full `:root` CSS variable set + font stylesheet to `documentElement`.
 *
 * This is what kills the refresh flash for built-in themes: without it the
 * first paint shows the static default (Hermes Teal) from `index.css` until
 * the JS bundle loads and `ThemeProvider`'s effect re-applies the stored theme.
 *
 * **Single source of truth for the var mapping.** The per-theme variable map
 * is computed here with the *same* `themeVars()` the runtime provider uses in
 * `applyTheme()`, so the pre-paint values are byte-identical to the runtime
 * ones — when the provider re-applies on mount it is a visual no-op, not a
 * re-paint. If you add a var to `themeVars()`, it shows up in the bootstrap
 * automatically.
 *
 * User YAML themes are handled separately by the server-side critical-CSS shim
 * (`hermes_cli/web_server.py::_render_active_theme_bootstrap_css`), which has
 * access to `~/.hermes/dashboard-themes/*.yaml`. The two paths are independent:
 * the inline script only acts when the stored name is a built-in; for user
 * themes it leaves the canvas alone (the server shim already set it).
 *
 * Kept free of top-level DOM access so it can be imported from the Vite config
 * (Node) purely to produce the script text.
 */
import { BUILTIN_THEMES, defaultTheme } from "./presets";
import {
  FONT_CHOICES,
  THEME_DEFAULT_FONT_ID,
  type FontChoice,
} from "./fonts";
import {
  THEME_STORAGE_KEY,
  FONT_STORAGE_KEY,
  THEME_NAME_ALIASES,
  themeVars,
} from "./themeVars";
import type { DashboardTheme } from "./types";

/** Per-theme payload the inline script needs. `vars` is the complete, pre-
 *  computed `:root` map from `themeVars()` (palette, typography, layout,
 *  overrides, series, assets, component styles). The few fields applyTheme()
 *  handles *around* `themeVars()` (font stylesheet, terminal colors, layout
 *  variant) are carried alongside so the pre-paint state matches the runtime
 *  state. No built-in theme ships `customCSS`, so none is embedded. */
interface ThemePayload {
  vars: Record<string, string>;
  fontUrl?: string;
  terminalBackground?: string;
  terminalForeground?: string;
  layoutVariant?: string;
}

function serialiseThemePayload(t: DashboardTheme): ThemePayload {
  const payload: ThemePayload = { vars: themeVars(t) };
  if (t.typography?.fontUrl) payload.fontUrl = t.typography.fontUrl;
  if (t.terminalBackground) payload.terminalBackground = t.terminalBackground;
  if (t.terminalForeground) payload.terminalForeground = t.terminalForeground;
  if (t.layoutVariant) payload.layoutVariant = t.layoutVariant;
  return payload;
}

function serialiseFont(f: FontChoice) {
  const out: Record<string, unknown> = { id: f.id, stack: f.stack };
  if (f.fontUrl) out.fontUrl = f.fontUrl;
  return out;
}

/** Escape a JS value for safe embedding inside `<script>…</script>`: encode
 *  every `<` as `\u003c` so no theme/font value can ever terminate the tag. */
function jsStr(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

/**
 * Produce the full inline bootstrap script. Importable from `vite.config.ts`
 * (build + dev) and from tests. Returns a self-contained IIFE string.
 */
export function buildBootstrapScript(): string {
  const themes: Record<string, ThemePayload> = Object.fromEntries(
    Object.values(BUILTIN_THEMES).map((t) => [t.name, serialiseThemePayload(t)]),
  );
  const fonts = FONT_CHOICES.map(serialiseFont);

  return `(function(){
try{
var THEMES=${jsStr(themes)};
var FONTS=${jsStr(fonts)};
var ALIASES=${jsStr(THEME_NAME_ALIASES)};
var DEF=${jsStr(defaultTheme.name)};
var THEME_KEY=${jsStr(THEME_STORAGE_KEY)};
var FONT_KEY=${jsStr(FONT_STORAGE_KEY)};
var THEME_DEFAULT_FONT=${jsStr(THEME_DEFAULT_FONT_ID)};
var root=document.documentElement;
if(!root)return;
function read(key){try{return window.localStorage.getItem(key);}catch(e){return null;}}
function linkFont(url){if(!url)return;var sel='link[rel="stylesheet"][data-hermes-theme-font="true"][href="'+String(url).replace(/"/g,'\\"')+'"]';if(document.querySelector(sel))return;var a=document.createElement("link");a.rel="stylesheet";a.href=url;a.setAttribute("data-hermes-theme-font","true");document.head.appendChild(a);}
var name=(typeof window!=="undefined"&&typeof window.__HERMES_ACTIVE_THEME__==="string"&&window.__HERMES_ACTIVE_THEME__)||read(THEME_KEY)||DEF;
if(ALIASES[name])name=ALIASES[name];
// Only built-ins are pre-applied here. User YAML themes are handled by the
// server's critical-CSS shim (it can read ~/.hermes/dashboard-themes); unknown
// or stale names fall through to the static default palette in index.css.
var t=THEMES[name];
if(!t)return;
var k;
for(k in t.vars){root.style.setProperty(k,t.vars[k]);}
if(t.terminalBackground)root.style.setProperty("--theme-terminal-background",t.terminalBackground);
if(t.terminalForeground)root.style.setProperty("--theme-terminal-foreground",t.terminalForeground);
var lv=t.layoutVariant||"standard";root.dataset.layoutVariant=lv;root.style.setProperty("--theme-layout-variant",lv);
linkFont(t.fontUrl);
// Re-assert an independent font override on top of the theme's font, mirroring
// applyFontOverride() so a refresh keeps the user's picked font.
var fid=read(FONT_KEY)||THEME_DEFAULT_FONT;
if(fid!==THEME_DEFAULT_FONT){for(var f=0;f<FONTS.length;f++){if(FONTS[f].id===fid){linkFont(FONTS[f].fontUrl);root.style.setProperty("--theme-font-override-sans",FONTS[f].stack);root.style.setProperty("--theme-font-sans",FONTS[f].stack);root.style.setProperty("--theme-font-display",FONTS[f].stack);break;}}}
}catch(e){}
})();`;
}
