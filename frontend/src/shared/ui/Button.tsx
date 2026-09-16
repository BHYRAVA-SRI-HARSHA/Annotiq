import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

// Pill-shaped, own-brand button family — rounded fully instead of the
// generic 6px-radius rectangle, with a filled-teal primary and a
// bordered-amber-on-hover secondary, so every button across the toolbar,
// dialogs, and panels shares one distinct look instead of a plain
// rectangle-with-border shape.
const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "var(--color-accent)",
    color: "var(--color-accent-contrast)",
    border: "1px solid var(--color-accent)",
    boxShadow: "var(--shadow-card)",
  },
  secondary: {
    background: "var(--color-bg)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
  },
  ghost: {
    background: "transparent",
    color: "var(--color-text-muted)",
    border: "1px solid transparent",
  },
};

export function Button({ variant = "secondary", style, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        padding: "7px 16px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: 0.1,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        whiteSpace: "nowrap",
        transition: "filter 0.12s ease",
        ...variantStyles[variant],
        ...style,
      }}
    />
  );
}
