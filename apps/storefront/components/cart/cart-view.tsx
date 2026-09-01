"use client"

import { t, type Locale } from "@/lib/i18n"

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Minus, Plus, Trash2 } from "lucide-react"
import { Price } from "@/components/price"
import { Totals } from "@/components/totals"
import { buttonVariants } from "@/components/ui/button"
import { removeFromCart, setLineQuantity } from "@/lib/cart-actions"
import { digits } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Cart } from "@/lib/medusa"

export function CartView({ cart: initial, locale }: { cart: Cart; locale: Locale }) {
  const router = useRouter()
  const [cart, setCart] = useState(initial)
  const [pendingLine, setPendingLine] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function mutate(lineId: string, fn: () => Promise<Cart | null>) {
    setPendingLine(lineId)
    setError(null)
    startTransition(async () => {
      try {
        const next = await fn()
        if (next) setCart(next)
        router.refresh()
      } catch {
        setError(t(locale, "cart.updateFailed"))
      } finally {
        setPendingLine(null)
      }
    })
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {cart.items.map((line) => {
          const busy = pendingLine === line.id
          return (
            <li key={line.id} className={cn("flex gap-4 p-4", busy && "opacity-60")}>
              <Link
                href={line.product_handle ? `/p/${line.product_handle}` : "#"}
                className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-24"
              >
                {line.thumbnail ? (
                  <Image src={line.thumbnail || "/placeholder.svg"} alt={line.title} fill sizes="96px" className="object-cover" />
                ) : null}
              </Link>

              <div className="flex flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium leading-snug text-pretty sm:text-base">{line.title}</h3>
                    {line.variant_title ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{line.variant_title}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => mutate(line.id, () => removeFromCart(line.id))}
                    disabled={busy}
                    aria-label={`${t(locale, "cart.remove")} ${line.title}`}
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3">
                  <div className="flex items-center rounded-xl border border-border">
                    <button
                      type="button"
                      onClick={() => mutate(line.id, () => setLineQuantity(line.id, line.quantity - 1))}
                      disabled={busy}
                      aria-label={t(locale, "cart.decrease")}
                      className="flex size-9 items-center justify-center text-foreground disabled:opacity-40"
                    >
                      <Minus className="size-4" aria-hidden="true" />
                    </button>
                    <span className="tabular w-9 text-center text-sm font-semibold">
                      {digits(locale, line.quantity)}
                    </span>
                    <button
                      type="button"
                      onClick={() => mutate(line.id, () => setLineQuantity(line.id, line.quantity + 1))}
                      disabled={busy}
                      aria-label={t(locale, "cart.increase")}
                      className="flex size-9 items-center justify-center text-foreground disabled:opacity-40"
                    >
                      <Plus className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <Price locale={locale} halalas={line.total} className="text-base font-semibold" />
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <aside className="space-y-4 rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-24">
        <h2 className="text-lg font-bold">{t(locale, "totals.title")}</h2>
        <Totals locale={locale}
          itemTotal={cart.item_total}
          shippingTotal={cart.shipping_total}
          taxTotal={cart.tax_total}
          discountTotal={cart.discount_total}
          total={cart.total}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Link href={`/${locale}/checkout`} className={buttonVariants({ className: "h-12 w-full text-base font-semibold" })}>
          {t(locale, "cart.checkout")}
        </Link>
        <Link
          href={`/${locale}`}
          className="block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t(locale, "cart.continue")}
        </Link>
      </aside>
    </div>
  )
}
