import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  children,
  className,
  icon,
  variant = "secondary",
  size = "md",
  ...props
}: ButtonProps, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md border font-medium transition",
        "focus:outline-none focus:ring-2 focus:ring-ore-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" && "border-ore-600 bg-ore-600 text-white hover:bg-ore-700",
        variant === "secondary" && "border-coal-200 bg-white text-coal-800 hover:bg-coal-50",
        variant === "ghost" && "border-transparent bg-transparent text-coal-700 hover:bg-coal-100",
        variant === "danger" && "border-safety-red bg-safety-red text-white hover:bg-red-700",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});
