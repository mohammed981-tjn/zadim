import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Container } from "@/components/container"
import { CheckoutFlow } from "@/components/checkout/checkout-flow"
import { ErrorState } from "@/components/states"
import { loadCart } from "@/lib/cart-actions"
import { isSignedIn, savedAddresses } from "@/lib/auth-actions"
import { getShippingOptions, type ShippingOption } from "@/lib/medusa"
import { t, type Locale } from "@/lib/i18n"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  return { title: `${t(locale, "checkout.title")} — ${t(locale, "site.name")}` }
}

export const dynamic = "force-dynamic"

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: Locale }>
}) {
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

  if (!cart || cart.items.length === 0) {
    redirect(`/${locale}/cart`)
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

  // عناوينُ من دخل — وقائمةٌ فارغةٌ للضيف. والضيفُ مسارٌ كاملُ الحقوق
  // (بند ٨)، فلا شيءَ هنا يشترط حساباً.
  const [addresses, signedIn] = await Promise.all([savedAddresses(), isSignedIn()])

  return (
    <Container className="py-8 md:py-12">
      <h1 className="mb-8 text-2xl font-bold md:text-3xl">{t(locale, "checkout.title")}</h1>
      <CheckoutFlow
        cart={cart}
        shippingOptions={shippingOptions}
        savedAddresses={addresses}
        signedIn={signedIn}
        locale={locale}
      />
    </Container>
  )
}
