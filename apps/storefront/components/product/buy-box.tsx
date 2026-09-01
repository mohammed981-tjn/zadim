"use client"

import { t, type Locale } from "@/lib/i18n"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Check, Minus, Plus } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Price } from "@/components/price"
import { addToCart } from "@/lib/cart-actions"
import { cn } from "@/lib/utils"
import type { Product, ProductVariant } from "@/lib/medusa"

function isOut(v: ProductVariant) {
  return typeof v.inventory_quantity === "number" && v.inventory_quantity <= 0
}

export function BuyBox({ product, locale }: { product: Product; locale: Locale }) {
  const router = useRouter()
  const variants = product.variants ?? []
  const firstAvailable = variants.find((v) => !isOut(v)) ?? variants[0]

  const [variantId, setVariantId] = useState<string | undefined>(firstAvailable?.id)
  const [qty, setQty] = useState(1)
  const [pending, startTransition] = useTransition()
  const [added, setAdded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = variants.find((v) => v.id === variantId)
  const price = selected?.price ?? product.price ?? null
  const soldOut = selected ? isOut(selected) : false

  function handleAdd() {
    if (!variantId) return
    setError(null)
    setAdded(false)
    startTransition(async () => {
      try {
        await addToCart(variantId, qty)
        setAdded(true)
        router.refresh()
      } catch {
        setError(t(locale, "product.addFailed"))
      }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-snug text-balance sm:text-3xl">{product.title}</h1>
        {product.subtitle ? (
          <p className="mt-2 text-sm text-muted-foreground text-pretty">{product.subtitle}</p>
        ) : null}
      </div>

      {price != null ? (
        <Price locale={locale} halalas={price} className="text-2xl font-bold sm:text-3xl" symbolClassName="text-base" />
      ) : (
        <p className="text-lg text-muted-foreground">{t(locale, "product.priceOnRequest")}</p>
      )}

      {variants.length > 1 ? (
        <div className="space-y-3">
          <span className="block text-sm font-medium">{t(locale, "product.chooseOption")}</span>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const out = isOut(v)
              const isSel = v.id === variantId
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={out}
                  onClick={() => {
                    setVariantId(v.id)
                    setAdded(false)
                  }}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-sm transition-colors",
                    isSel
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-foreground/40",
                    out && "cursor-not-allowed opacity-40 line-through",
                  )}
                >
                  {v.title}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* Quantity */}
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">{t(locale, "product.quantity")}</span>
        <div className="flex items-center rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label={t(locale, "cart.decrease")}
            className="flex size-10 items-center justify-center text-foreground disabled:opacity-40"
          >
            <Minus className="size-4" aria-hidden="true" />
          </button>
          <span className="tabular w-10 text-center text-sm font-semibold" aria-live="polite">
            {locale === "ar" ? qty.toLocaleString("ar-EG") : qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => q + 1)}
            aria-label={t(locale, "cart.increase")}
            className="flex size-10 items-center justify-center text-foreground"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <Button
          onClick={handleAdd}
          disabled={pending || soldOut || !variantId}
          className="h-12 w-full text-base font-semibold"
        >
          {soldOut
            ? t(locale, "product.soldOut")
            : pending
              ? t(locale, "product.adding")
              : t(locale, "product.addToCart")}
        </Button>

        {added ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm">
            <span className="flex items-center gap-2 text-success">
              <Check className="size-4" aria-hidden="true" />
              {t(locale, "product.added")}
            </span>
            <Link href={`/${locale}/cart`} className={buttonVariants({ variant: "outline", size: "sm", className: "h-9" })}>
              {t(locale, "product.viewCart")}
            </Link>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {product.description ? (
        <div className="border-t border-border pt-6">
          <h2 className="mb-2 text-base font-semibold">{t(locale, "product.details")}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">{product.description}</p>
        </div>
      ) : null}
    </div>
  )
}
