export function Card({ className = "", children, ...props }) {
  return (
    <div
      className={["rounded-2xl", "border", "border-white/10", "bg-[#101827]/95", "shadow-[0_16px_60px_rgba(0,0,0,0.28)]", className].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...props }) {
  return <div className={["flex", "items-start", "justify-between", "gap-3", className].join(" ")} {...props}>{children}</div>;
}

export function CardTitle({ className = "", children, ...props }) {
  return <h3 className={["text-sm", "font-semibold", "tracking-[0.2em]", "uppercase", "text-slate-200", className].join(" ")} {...props}>{children}</h3>;
}

export function CardContent({ className = "", children, ...props }) {
  return <div className={["space-y-4", className].join(" ")} {...props}>{children}</div>;
}
