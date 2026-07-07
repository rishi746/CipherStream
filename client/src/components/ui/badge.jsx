import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[#58a6ff]/15 text-[#58a6ff]",
        secondary: "border-white/10 bg-[#111827] text-slate-300",
        success: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
        destructive: "border-rose-400/20 bg-rose-500/10 text-rose-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant, className }))} {...props} />;
}
