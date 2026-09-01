import { t, type Locale } from "@/lib/i18n"
import type { Metadata } from "next"
import { Container } from "@/components/container"
import { CartView } from "@/components/cart/cart-view"
import { EmptyState, ErrorState } from "@/components/states"
import { loadCart } from "@/lib/cart-actions"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  return { title: `${t(locale, "cart.title")} — ${t(locale, "site.name")}` }
}
export const dynamic = "force-dynamic"

export default async function CartPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params

  let cart
  try {
    cart = await loadCart()
  } catch {
    return (
      <Container className="py-16">
        <ErrorState title={t(locale, "cart.loadFailed")} description={t(locale, "cart.retryHint")} />
      </Container>
    )
  }

  return (
    <Container className="py-8 sm:py-12">
      <h1 className="mb-8 text-2xl font-bold sm:text-3xl">{t(locale, "cart.title")}</h1>
      {cart && cart.items.length ? (
        <CartView cart={cart} locale={locale} />
      ) : (
        <EmptyState
          title={t(locale, "cart.empty")}
          description={t(locale, "cart.emptyBody")}
          actionHref={`/${locale}`}
          actionLabel={t(locale, "cart.startShopping")}
        />
      )}
    </Container>
  )
}
