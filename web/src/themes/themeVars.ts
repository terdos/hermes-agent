/**
 * Pure CSS-variable builders for a `DashboardTheme`.
 *
 * Single source of truth for the mapping from theme model → `:root` CSS
 * variables, shared by two callers:
 *
 *   1. `applyTheme()` in `context.tsx` — applies the theme on React mount and
 *      on every runtime theme/font switch.
 *   2. The build-time inline bootstrap script (see `vite.config.ts`) — applies
 *      the stored built-in theme + font override to `:root` *before* first
 *      paint so a refresh doesn't flash the default Hermes Teal palette.
 *
 * Keeping the mapping here means the pre-paint script and the runtime provider
 * can never drift apart: both call `themeVars()` and write the identical set
 * of variables.
 *
 * IMPORTANT: the backend's `_render_active_theme_bootstrap_css()` in
 * `hermes_cli/web_server.py` mirrors these exact variable names for user YAML
 * themes. If you rename or add a var here, update that helper too (guarded by
 * `tests/hermes_cli/test_web_server.py::TestThemeBootstrapCSS`).
 */
import type {
  DashboardTheme,
  ThemeColorOverrides,
  ThemeComponentStyles,
  ThemeDensity,
  ThemeLayer,
  ThemePalette,
  ThemeSeriesColors,
  ThemeTypography,
  ThemeLayout,
} from "./types";

/** Spacing multipliers per density bucket. `comfortable` = 1 (unchanged). */
export const DENSITY_MULTIPLIERS: Record<ThemeDensity, string> = {
  compact: "0.85",
  comfortable: "1",
  spacious: "1.2",
};

// ---------------------------------------------------------------------------
// Persistence keys + name migration — shared by the pre-paint bootstrap
// script (vite.config.ts → bootstrapScript.ts) and the React provider
// (context.tsx) so both read/write the same localStorage entries.
// ---------------------------------------------------------------------------

/** LocalStorage key for the active theme name. */
export const THEME_STORAGE_KEY = "hermes-dashboard-theme";

/** LocalStorage key for the font override (independent of theme). */
export const FONT_STORAGE_KEY = "hermes-dashboard-font";

/** Renames of built-in theme keys we've shipped previously. Without this,
 *  users who saved one of the old names in localStorage (or had it
 *  persisted server-side) would silently fall back to `defaultTheme`
 *  because the lookup in `resolveTheme` no longer finds the stale key.
 *  Keep entries here until enough release cycles have passed that we can
 *  reasonably assume nobody still has the old value persisted. */
export const THEME_NAME_ALIASES: Record<string, string> = {
  // Renamed during the LENS_5I port + Nous-blue rebrand.
  "lens-5i": "nous-blue",
};

export function migrateThemeName(name: string): string {
  return THEME_NAME_ALIASES[name] ?? name;
}

/** Map a color-overrides key (camelCase) to its `--color-*` CSS var. */
export const OVERRIDE_KEY_TO_VAR: Record<keyof ThemeColorOverrides, string> = {
  card: "--color-card",
  cardForeground: "--color-card-foreground",
  popover: "--color-popover",
  popoverForeground: "--color-popover-foreground",
  primary: "--color-primary",
  primaryForeground: "--color-primary-foreground",
  secondary: "--color-secondary",
  secondaryForeground: "--color-secondary-foreground",
  muted: "--color-muted",
  mutedForeground: "--color-muted-foreground",
  accent: "--color-accent",
  accentForeground: "--color-accent-foreground",
  destructive: "--color-destructive",
  destructiveForeground: "--color-destructive-foreground",
  success: "--color-success",
  warning: "--color-warning",
  border: "--color-border",
  input: "--color-input",
  ring: "--color-ring",
};

/** Map data-series accents to their CSS vars. Themes omit either field to
 *  inherit the `:root` default from `index.css`. */
export const SERIES_KEY_TO_VAR: Record<keyof ThemeSeriesColors, string> = {
  inputTokenAccent: "--series-input-token",
  outputTokenAccent: "--series-output-token",
};

function toKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** Turn a ThemeLayer into the two CSS expressions the DS consumes:
 *  `--<name>` (color-mix'd with alpha) and `--<name>-base` (opaque hex). */
export function layerVars(
  name: "background" | "midground" | "foreground",
  layer: ThemeLayer,
): Record<string, string> {
  const pct = Math.round(layer.alpha * 100);
  return {
    [`--${name}`]: `color-mix(in srgb, ${layer.hex} ${pct}%, transparent)`,
    [`--${name}-base`]: layer.hex,
    [`--${name}-alpha`]: String(layer.alpha),
  };
}

export function paletteVars(palette: ThemePalette): Record<string, string> {
  return {
    ...layerVars("background", palette.background),
    ...layerVars("midground", palette.midground),
    ...layerVars("foreground", palette.foreground),
  };
}

export function typographyVars(typo: ThemeTypography): Record<string, string> {
  return {
    "--theme-font-sans": typo.fontSans,
    "--theme-font-mono": typo.fontMono,
    "--theme-font-display": typo.fontDisplay ?? typo.fontSans,
    "--theme-base-size": typo.baseSize,
    "--theme-line-height": typo.lineHeight,
    "--theme-letter-spacing": typo.letterSpacing,
  };
}

export function layoutVars(layout: ThemeLayout): Record<string, string> {
  return {
    "--radius": layout.radius,
    "--theme-radius": layout.radius,
    "--theme-spacing-mul": DENSITY_MULTIPLIERS[layout.density] ?? "1",
    "--theme-density": layout.density,
  };
}

export function overrideVars(
  overrides: ThemeColorOverrides | undefined,
): Record<string, string> {
  if (!overrides) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!value) continue;
    const cssVar = OVERRIDE_KEY_TO_VAR[key as keyof ThemeColorOverrides];
    if (cssVar) out[cssVar] = value;
  }
  return out;
}

export function seriesColorVars(
  series: ThemeSeriesColors | undefined,
): Record<string, string> {
  if (!series) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(series)) {
    if (!value) continue;
    const cssVar = SERIES_KEY_TO_VAR[key as keyof ThemeSeriesColors];
    if (cssVar) out[cssVar] = value;
  }
  return out;
}

/** Map a camelCase prop to kebab-case (`clipPath` → `clip-path`). */
export { toKebab as toKebabCase };

/** Well-known named asset slots a theme may populate. Kept in sync with
 *  `_THEME_NAMED_ASSET_KEYS` in `hermes_cli/web_server.py`. */
export const NAMED_ASSET_KEYS = [
  "bg",
  "hero",
  "logo",
  "crest",
  "sidebar",
  "header",
] as const;

/** Component buckets mirrored from the backend's `_THEME_COMPONENT_BUCKETS`.
 *  Each bucket emits `--component-<bucket>-<kebab-prop>` CSS vars. */
export const COMPONENT_BUCKETS = [
  "card",
  "header",
  "footer",
  "sidebar",
  "tab",
  "progress",
  "badge",
  "backdrop",
  "page",
] as const;

/** Build `--theme-asset-*` CSS vars from the assets block. Values are wrapped
 *  in `url(...)` when they look like a bare path/URL; raw CSS expressions
 *  (`linear-gradient(...)`, pre-wrapped `url(...)`, `none`) pass through. */
export function assetVars(
  assets: DashboardTheme["assets"],
): Record<string, string> {
  if (!assets) return {};
  const out: Record<string, string> = {};
  const wrap = (v: string): string => {
    const trimmed = v.trim();
    if (!trimmed) return "";
    // Already a CSS image/gradient/url/none — don't re-wrap.
    if (
      /^(url\(|linear-gradient|radial-gradient|conic-gradient|none$)/i.test(
        trimmed,
      )
    ) {
      return trimmed;
    }
    // Bare path / http(s) URL / data: URL → wrap in url().
    return `url("${trimmed.replace(/"/g, '\\"')}")`;
  };
  for (const key of NAMED_ASSET_KEYS) {
    const val = assets[key];
    if (typeof val === "string" && val.trim()) {
      out[`--theme-asset-${key}`] = wrap(val);
      out[`--theme-asset-${key}-raw`] = val;
    }
  }
  if (assets.custom) {
    for (const [key, val] of Object.entries(assets.custom)) {
      if (typeof val !== "string" || !val.trim()) continue;
      if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue;
      out[`--theme-asset-custom-${key}`] = wrap(val);
      out[`--theme-asset-custom-${key}-raw`] = val;
    }
  }
  return out;
}

/** Build `--component-<bucket>-<prop>` CSS vars from the componentStyles
 *  block. Values pass through untouched so themes can use any CSS expression. */
export function componentStyleVars(
  styles: ThemeComponentStyles | undefined,
): Record<string, string> {
  if (!styles) return {};
  const out: Record<string, string> = {};
  for (const bucket of COMPONENT_BUCKETS) {
    const props = (
      styles as Record<string, Record<string, string> | undefined>
    )[bucket];
    if (!props) continue;
    for (const [prop, value] of Object.entries(props)) {
      if (typeof value !== "string" || !value.trim()) continue;
      // Same guardrail as backend — camelCase or kebab-case alnum only.
      if (!/^[a-zA-Z0-9_-]+$/.test(prop)) continue;
      out[`--component-${bucket}-${toKebab(prop)}`] = value;
    }
  }
  return out;
}

/**
 * The complete set of `:root` CSS variables a theme installs — palette,
 * typography, layout, color overrides, series colors, assets, and component
 * styles. The caller applies these (and, separately, the theme's font
 * stylesheet + customCSS) to `documentElement`.
 */
export function themeVars(theme: DashboardTheme): Record<string, string> {
  return {
    ...paletteVars(theme.palette),
    ...typographyVars(theme.typography),
    ...layoutVars(theme.layout),
    ...overrideVars(theme.colorOverrides),
    ...seriesColorVars(theme.seriesColors),
    ...assetVars(theme.assets),
    ...componentStyleVars(theme.componentStyles),
  };
}
