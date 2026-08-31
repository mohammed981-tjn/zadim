"use server"

import { cookies } from "next/headers"
import {
  addShippingMethod,
  checkoutCart,
  getShippingOptions,
  quoteCart,
  type CheckoutResult,
  type Quote,
  type ShippingOption,
} from "@/lib/medusa"

const COOKIE = "zadim_cart_id"

async function requireCartId(): Promise<string> {
  const store = await cookies()
  const id = store.get(COOKIE)?.value
  if (!id) throw new Error("NO_CART")
  return id
}

/** Real shipping options for the current cart. */
export async function listShippingOptions(): Promise<ShippingOption[]> {
  const id = await requireCartId()
  return getShippingOptions(id)
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
