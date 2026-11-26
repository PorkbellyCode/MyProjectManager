import { cn } from "@/lib/utils";

/** 긴급도는 색이 아니라 막대 4개의 높이로 보인다(디자인 규칙 3.2). 글자는 옆에 따로 둔다. */
export function UrgencyBars({ level, className }: { level: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex h-3.5 items-end gap-[2px]", className)}>
      {[5, 8, 11, 14].map((h, i) => (
        <span key={h} className={cn("w-[3px] rounded-[1px]", i < level ? "bg-current" : "bg-line")} style={{ height: h }} />
      ))}
    </span>
  );
}
