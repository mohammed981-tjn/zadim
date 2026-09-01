import { type Locale } from "@/lib/i18n"
import { Container } from "@/components/container"
import { ProductGrid } from "@/components/product-grid"
import { EmptyState } from "@/components/states"
import { getProductsByHandles, type ProductGridPayload } from "@/lib/medusa"

export async function ProductGridBlock({ payload, locale }: { payload: ProductGridPayload; locale: Locale }) {
  if (!payload?.handles?.length) return null

  let products
  try {
    products = await getProductsByHandles(payload.handles, locale)
  } catch {
    // A single failing block must not crash the whole home page.
    return null
  }

  if (!products.length) return null

  return (
    <section className="py-10 sm:py-14">
      <Container className="space-y-6">
        {payload.title ? <h2 className="text-xl font-bold sm:text-2xl">{payload.title}</h2> : null}
        <ProductGrid products={products} locale={locale} />
      </Container>
    </section>
  )
}
