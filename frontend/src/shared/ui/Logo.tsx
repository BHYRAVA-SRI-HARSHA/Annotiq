import { useTheme } from "@/shared/theme";

interface LogoProps {
  /** Icon/wordmark height in px. */
  size?: number;
  withWordmark?: boolean;
  style?: React.CSSProperties;
  /**
   * Force the light-on-dark wordmark variant regardless of the app theme.
   * Use this on surfaces that are always dark (e.g. the login page's brand
   * panel), since those aren't governed by the light/dark theme toggle at
   * all — reading the current theme there would pick the wrong asset.
   */
  onDark?: boolean;
}

// Single source of the Annotiq mark. All three images are transparent PNGs
// (no baked-in background) so they composite correctly on any surface.
// The wordmark ships in two color variants — the default ink-navy one for
// light surfaces, and a white-on-navy one for dark surfaces (the navy
// lettering is otherwise unreadable against a dark background). The icon
// doesn't need a variant: its colors are all vivid gradient blues/purples
// that hold up against light or dark alike.
export function Logo({ size = 24, withWordmark = true, style, onDark = false }: LogoProps) {
  // Subscribed to the same shared theme hook the toggle button writes to
  // (instead of reading document.documentElement.dataset.theme once at
  // render time) so the wordmark swaps the instant the toggle fires. A
  // one-off DOM read only updates whenever this component happens to
  // re-render for some unrelated reason — which is why switching themes
  // used to leave the wrong-color logo on screen until some other state
  // change (e.g. navigating pages) forced a re-render.
  const [theme] = useTheme();
  const isDark = onDark || theme === "dark";
  const src = !withWordmark ? "/logo-icon.png" : isDark ? "/logo-wordmark-light.png" : "/logo-wordmark.png";
  return <img src={src} alt="Annotiq" style={{ height: size, width: "auto", display: "block", ...style }} />;
}
