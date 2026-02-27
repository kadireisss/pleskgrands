import { cn } from "@/lib/utils";

export function StatPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "primary" | "accent";
}) {
  const toneClasses =
    tone === "primary"
      ? "bg-primary/10 text-primary border-primary/20"
      : tone === "accent"
        ? "bg-accent/10 text-accent border-accent/20"
        : "bg-muted text-foreground border-border";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-2xl border px-3 py-1.5",
        "shadow-sm",
        toneClasses,
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tracking-tight">{value}</span>
    </div>
  );
}
