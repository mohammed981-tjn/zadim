import { t, type Locale } from "@/lib/i18n"
import Image from "next/image"
import Link from "next/link"
import { Price } from "@/components/price"
import type { Product } from "@/lib/medusa"

function lowestPrice(p: Product): number | null {
  if (typeof p.price === "number") return p.price
  const prices = (p.variants ?? []).map((v) => v.price).filter((n) => typeof n === "number")
  return prices.length ? Math.min(...prices) : null
}

export function ProductCard({
  product,
  locale,
  priority = false,
}: {
  product: Product
  locale: Locale
  priority?: boolean
}) {
  const image = product.thumbnail || product.images?.[0]?.url
  const price = lowestPrice(product)

  return (
    <Link
      href={`/${locale}/p/${product.handle}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        {image ? (
          <Image
            src={image || "/placeholder.svg"}
            alt={product.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t(locale, "product.noImage")}</div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground sm:text-base">
          {product.title}
        </h3>
        <div className="mt-auto">
          {price != null ? (
            <Price locale={locale} halalas={price} className="text-base font-semibold sm:text-lg" />
          ) : (
            <span className="text-sm text-muted-foreground">{t(locale, "product.priceOnRequest")}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
