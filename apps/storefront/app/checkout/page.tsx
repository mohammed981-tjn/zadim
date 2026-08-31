import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Container } from "@/components/container"
import { CheckoutFlow } from "@/components/checkout/checkout-flow"
import { ErrorState } from "@/components/states"
import { loadCart } from "@/lib/cart-actions"
import { getShippingOptions, type ShippingOption } from "@/lib/medusa"

export const metadata: Metadata = {
  title: "إتمام الطلب — زادم",
}

export const dynamic = "force-dynamic"

export default async function CheckoutPage() {
  let cart
  try {
    cart = await loadCart()
  } catch {
    return (
      <Container className="py-16">
        <ErrorState title="تعذّر تحميل السلة" description="حدّث الصفحة وحاول مرة أخرى." />
      </Container>
    )
  }

  if (!cart || cart.items.length === 0) {
    redirect("/cart")
  }

  // نوعٌ صريح: بلا هذا يستنتج TypeScript ‏`never[]` من `[]` ثم يشكو من
  // إسنادِ خيارات الشحن إليه. وهذان الخطآن هما اللذان مرّا في v0 خلف
  // `ignoreBuildErrors` — أُزيل الغطاء وأُصلح الخطأ.
  let shippingOptions: ShippingOption[] = []
  try {
    shippingOptions = await getShippingOptions(cart.id)
  } catch {
    shippingOptions = []
  }

  return (
    <Container className="py-8 md:py-12">
      <h1 className="mb-8 text-2xl font-bold md:text-3xl">إتمام الطلب</h1>
      <CheckoutFlow cart={cart} shippingOptions={shippingOptions} />
    </Container>
  )
}
