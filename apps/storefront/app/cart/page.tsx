import type { Metadata } from "next"
import { Container } from "@/components/container"
import { CartView } from "@/components/cart/cart-view"
import { EmptyState, ErrorState } from "@/components/states"
import { loadCart } from "@/lib/cart-actions"

export const metadata: Metadata = { title: "سلة التسوّق — زادم" }
export const dynamic = "force-dynamic"

export default async function CartPage() {
  let cart
  try {
    cart = await loadCart()
  } catch {
    return (
      <Container className="py-16">
        <ErrorState title="تعذّر تحميل السلة" />
      </Container>
    )
  }

  return (
    <Container className="py-8 sm:py-12">
      <h1 className="mb-8 text-2xl font-bold sm:text-3xl">سلة التسوّق</h1>
      {cart && cart.items.length ? (
        <CartView cart={cart} />
      ) : (
        <EmptyState
          title="سلّتك فارغة"
          description="أضف منتجات إلى سلّتك لتظهر هنا."
          actionHref="/"
          actionLabel="ابدأ التسوّق"
        />
      )}
    </Container>
  )
}
