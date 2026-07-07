import { cva } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07111f] disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        default: "bg-[#58a6ff] text-[#07111f] shadow-[0_8px_30px_rgba(88,166,255,0.24)] hover:-translate-y-0.5 hover:shadow-[0_14px_35px_rgba(88,166,255,0.28)]",
        secondary: "border border-white/10 bg-[#111827] text-slate-100 hover:bg-[#1a2334]",
        ghost: "bg-transparent text-slate-300 hover:bg-white/5 hover:text-white",
        destructive: "bg-[#f87171] text-white hover:bg-[#ef4444]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3",
        lg: "h-11 rounded-xl px-5",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export const Button = forwardRef(function Button(
  { className, variant, size, asChild = false, children, ...props },
  ref,
) {
  const Comp = asChild ? "span" : "button";
  return (
    <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props}>
      {children}
    </Comp>
  );
});
