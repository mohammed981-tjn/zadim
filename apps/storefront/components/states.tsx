import Link from "next/link"
import { PackageOpen, TriangleAlert } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"

/** Honest empty state — shown when a real fetch returns nothing. */
export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string
  description?: string
  actionHref?: string
  actionLabel?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <PackageOpen className="size-10 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-balance">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground text-pretty">{description}</p> : null}
      </div>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className={buttonVariants({ className: "h-11 px-6 text-sm" })}>
          {actionLabel}
        </Link>
      ) : null}
    </div>
  )
}

/** Honest error state — shown when a real fetch fails. Never an eternal spinner. */
export function ErrorState({
  title = "تعذّر تحميل المحتوى",
  description,
}: {
  title?: string
  description?: string
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-16 text-center"
    >
      <TriangleAlert className="size-10 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-balance">{title}</h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {description ?? "حدث خطأ أثناء الاتصال بالمتجر. يرجى المحاولة مرة أخرى بعد قليل."}
        </p>
      </div>
    </div>
  )
}
