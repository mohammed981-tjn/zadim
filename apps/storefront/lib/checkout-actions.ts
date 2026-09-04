"use server"

import { cookies } from "next/headers"
import { readSession } from "@/lib/auth-actions"
import {
  addShippingMethod,
  applyCartCoupon,
  removeCartCoupon,
  checkoutCart,
  quoteCart,
  setCartAddress,
  type CheckoutResult,
  type CouponResult,
  type NationalAddressForm,
  type Quote,
  type SaveAddressResult,
} from "@/lib/medusa"

const COOKIE = "zadim_cart_id"

async function requireCartId(): Promise<string> {
  const store = await cookies()
  const id = store.get(COOKIE)?.value
  if (!id) throw new Error("NO_CART")
  return id
}

/**
 * يحفظ العنوانَ الوطنيَّ على السلّة.
 *
 * ⚠️ ويُنادى **قبل** خيارات الشحن لا بعدها: أجرةُ الشحن تُحسب للمنطقة
 * والعنوان، وقائمةٌ تُجلب قبل أن يُعرف العنوانُ قد لا تكون قائمتَه.
 */
export async function saveAddress(form: NationalAddressForm): Promise<SaveAddressResult> {
  const id = await requireCartId()
  // 🔴 الرمزُ يُمرَّر ولا يُمرَّر معرّفُ عميل: الخادمُ يشتقّ الهويّةَ منه
  // بنفسه. ومعرّفٌ في الجسم يربط سلّةً بحساب غيرِ صاحبها.
  const token = await readSession()
  return setCartAddress(id, form, token)
}

/** Attach the chosen shipping method so the quote reflects its cost. */
export async function selectShipping(optionId: string): Promise<void> {
  const id = await requireCartId()
  await addShippingMethod(id, optionId)
}

/** Get the authoritative quote the customer agrees to before confirming. */
export async function requestQuote(): Promise<Quote> {
  const id = await requireCartId()
  return quoteCart(id)
}

/**
 * Confirm the order. `idempotencyKey` is generated once by the client per
 * checkout attempt and reused on every retry, so a retried request can never
 * create a second order. On success the cart cookie is cleared.
 */
export async function confirmCheckout(idempotencyKey: string): Promise<CheckoutResult> {
  const id = await requireCartId()
  const result = await checkoutCart(id, idempotencyKey)
  if (result.ok) {
    const store = await cookies()
    store.delete(COOKIE)
  }
  return result
}

/**
 * رمزُ الخصم — فعلٌ خادميّ.
 *
 * ورسالةُ الرفض **تُعاد كما كتبها الخادم**: هو الذي يعرف السببَ
 * (منتهٍ · لا ينطبق · استُعمل من قبل · فوق السقف)، وصياغةٌ عامّةٌ هنا
 * تُخفي الفرقَ بين «رمزٌ خاطئ» و«رمزٌ صحيحٌ لا ينطبق على سلّتك» —
 * والثاني يُصلحه العميلُ بنفسه والأوّلُ لا.
 */
export async function applyCoupon(code: string): Promise<CouponResult> {
  const id = await requireCartId()
  const token = await readSession()
  return applyCartCoupon(id, code, token)
}

export async function dropCoupon(): Promise<void> {
  const id = await requireCartId()
  await removeCartCoupon(id)
}
