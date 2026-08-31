"use client"

import { TrendingDown, TrendingUp } from "lucide-react"
import { Price } from "@/components/price"
import { Button } from "@/components/ui/button"
import type { PriceChangedLine, QuotedTotals } from "@/lib/medusa"

/**
 * Shown when checkout returns 409 PRICE_CHANGED. Displays every changed line —
 * old price, new price, and the difference — and offers to re-quote. We NEVER
 * auto-accept a new price; the customer must press «أعِد التسعير».
 */
export function PriceChangedPanel({
  message,
  lines,
  totals,
  onReprice,
  repricing,
}: {
  message: string
  lines: PriceChangedLine[]
  totals?: QuotedTotals
  onReprice: () => void
  repricing: boolean
}) {
  return (
    <div
      role="alert"
      className="space-y-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-5 sm:p-6"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-bold">تغيّرت الأسعار</h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {message || "تغيّرت أسعار بعض المنتجات منذ أن أضفتها إلى سلّتك. راجع التغييرات قبل المتابعة."}
        </p>
      </div>

      {/* الحالةُ الثانية: المجموعُ تغيّر والأصنافُ كما هي (شحنٌ أو
          ضريبةٌ أو عرضٌ انتهى). ولا سطورَ تُعرض حينها — فيُعرض الفرقُ
          نفسُه، ولا يُترك الصندوقُ فارغاً تحت عنوانٍ يشكو. */}
      {!lines.length && totals ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <span className="text-sm font-medium">إجمالي الطلب</span>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground line-through">
              <Price halalas={totals.quoted_total} />
            </span>
            <span className="font-semibold text-foreground">
              <Price halalas={totals.current_total} />
            </span>
            <span
              className={`tabular inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${
                totals.difference > 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
              }`}
            >
              {totals.difference > 0 ? (
                <TrendingUp className="size-3.5" aria-hidden="true" />
              ) : (
                <TrendingDown className="size-3.5" aria-hidden="true" />
              )}
              <Price halalas={totals.difference} />
            </span>
          </div>
        </div>
      ) : null}

      {lines.length ? (
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {lines.map((line, i) => {
          const increased = line.difference > 0
          return (
            <li key={i} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-pretty">{line.title}</p>
                <p className="tabular text-xs text-muted-foreground">
                  الكمية: {line.quantity.toLocaleString("ar-EG")}
                </p>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground line-through">
                  <Price halalas={line.quoted_unit_price} />
                </span>
                <span className="font-semibold text-foreground">
                  <Price halalas={line.current_unit_price} />
                </span>
                <span
                  className={`tabular inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${
                    increased ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
                  }`}
                >
                  {increased ? (
                    <TrendingUp className="size-3.5" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="size-3.5" aria-hidden="true" />
                  )}
                  <Price halalas={line.difference} />
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      ) : null}

      <Button onClick={onReprice} disabled={repricing} className="h-11 w-full text-sm font-semibold sm:w-auto sm:px-8">
        {repricing ? "جارٍ إعادة التسعير…" : "أعِد التسعير"}
      </Button>
    </div>
  )
}
