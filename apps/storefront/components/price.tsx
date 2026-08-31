import { formatHalalas, SAR } from "@/lib/money"
import { cn } from "@/lib/utils"

/**
 * Renders integer halalas as an Arabic-Indic amount with the ر.س label.
 * The number uses tabular figures so aligned columns don't jitter.
 */
export function Price({
  halalas,
  className,
  symbolClassName,
}: {
  halalas: number
  className?: string
  symbolClassName?: string
}) {
  return (
    <span className={cn("tabular inline-flex items-baseline gap-1", className)}>
      <span>{formatHalalas(halalas)}</span>
      <span className={cn("text-[0.75em] font-medium text-muted-foreground", symbolClassName)}>{SAR}</span>
    </span>
  )
}
