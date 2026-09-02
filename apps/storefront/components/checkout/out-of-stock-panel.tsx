"use client"

import { t, type Locale } from "@/lib/i18n"

import Link from "next/link"
import { PackageX } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { digits } from "@/lib/money"
import type { OutOfStockLine } from "@/lib/medusa"

/** Shown when checkout returns 409 OUT_OF_STOCK — which items are short and by how much. */
export function OutOfStockPanel({
  locale,
  message,
  lines,
}: {
  locale: Locale
  message: string
  lines: OutOfStockLine[]
}) {
  return (
    <div role="alert" className="space-y-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <PackageX className="mt-0.5 size-6 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-lg font-bold">{t(locale, "outOfStock.title")}</h2>
          <p className="text-sm text-muted-foreground text-pretty">
            {message || t(locale, "outOfStock.body")}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {lines.map((line, i) => (
          <li key={i} className="flex items-center justify-between gap-4 p-4">
            <span className="text-sm font-medium text-pretty">{line.title}</span>
            <span className="tabular text-sm text-destructive">
              {t(locale, "outOfStock.short", { count: digits(locale, line.short_by) })}
            </span>
          </li>
        ))}
      </ul>

      <Link href={`/${locale}/cart`} className={buttonVariants({ variant: "outline", className: "h-11 px-8 text-sm font-semibold" })}>
        {t(locale, "outOfStock.editCart")}
      </Link>
    </div>
  )
}
