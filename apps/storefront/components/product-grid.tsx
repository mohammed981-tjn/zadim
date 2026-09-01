import { type Locale } from "@/lib/i18n"
import { ProductCard } from "@/components/product-card"
import type { Product } from "@/lib/medusa"

export function ProductGrid({
  products,
  locale,
  priorityCount = 0,
}: {
  products: Product[]
  locale: Locale
  priorityCount?: number
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {products.map((product, i) => (
        <ProductCard key={product.id} product={product} locale={locale} priority={i < priorityCount} />
      ))}
    </div>
  )
}
