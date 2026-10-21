import type { ButtonHTMLAttributes, ReactNode } from "react";

type OperatorControlButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  size?: "compact" | "regular";
  appearance?: "default" | "naval";
};

export function OperatorControlButton({ children, className = "", size = "regular", appearance = "default", ...props }: OperatorControlButtonProps) {
  return <button {...props} className={`operator-control-button operator-control-button-${size}${appearance === "naval" ? " operator-control-button-naval" : ""} ${className}`.trim()}>{children}</button>;
}
