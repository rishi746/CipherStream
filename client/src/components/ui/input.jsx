export function Input({ className = "", ...props }) {
  return (
    <input
      className={[
        "w-full",
        "rounded-xl",
        "border",
        "border-white/10",
        "bg-[#0b1220]",
        "px-4",
        "py-3",
        "text-sm",
        "text-slate-100",
        "outline-none",
        "ring-0",
        "placeholder:text-slate-500",
        "focus:border-[#58a6ff]",
        "focus:shadow-[0_0_0_3px_rgba(88,166,255,0.18)]",
        className,
      ].join(" ")}
      {...props}
    />
  );
}

export function Textarea({ className = "", ...props }) {
  return (
    <textarea
      className={[
        "min-h-[130px]",
        "w-full",
        "rounded-xl",
        "border",
        "border-white/10",
        "bg-[#0b1220]",
        "px-4",
        "py-3",
        "text-sm",
        "text-slate-100",
        "outline-none",
        "placeholder:text-slate-500",
        "focus:border-[#58a6ff]",
        "focus:shadow-[0_0_0_3px_rgba(88,166,255,0.18)]",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
