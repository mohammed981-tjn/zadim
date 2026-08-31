"use client"

import Link from "next/link"
import { PackageX } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { toArabicDigits } from "@/lib/money"
import type { OutOfStockLine } from "@/lib/medusa"

/** Shown when checkout returns 409 OUT_OF_STOCK — which items are short and by how much. */
export function OutOfStockPanel({ message, lines }: { message: string; lines: OutOfStockLine[] }) {
  return (
    <div role="alert" className="space-y-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <PackageX className="mt-0.5 size-6 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-1">
          <h2 className="text-lg font-bold">نفدت الكمية</h2>
          <p className="text-sm text-muted-foreground text-pretty">
            {message || "لم تعد الكميات المطلوبة متوفّرة بالكامل. عدّل سلّتك ثم حاول مرة أخرى."}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {lines.map((line, i) => (
          <li key={i} className="flex items-center justify-between gap-4 p-4">
            <span className="text-sm font-medium text-pretty">{line.title}</span>
            <span className="tabular text-sm text-destructive">
              ناقص {toArabicDigits(String(line.short_by))}
            </span>
          </li>
        ))}
      </ul>

      <Link href="/cart" className={buttonVariants({ variant: "outline", className: "h-11 px-8 text-sm font-semibold" })}>
        تعديل السلة
      </Link>
    </div>
  )
}
