"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import {
  addLineItem,
  createCart,
  getCart,
  removeLineItem,
  updateLineItem,
  type Cart,
} from "@/lib/medusa"

const COOKIE = "zadim_cart_id"

async function readCartId(): Promise<string | null> {
  const store = await cookies()
  return store.get(COOKIE)?.value ?? null
}

async function writeCartId(id: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}

/** Return the current cart id, or null if none / stale. */
export async function getCartId(): Promise<string | null> {
  return readCartId()
}

/** Load the current cart, healing a stale cookie by returning null. */
export async function loadCart(): Promise<Cart | null> {
  const id = await readCartId()
  if (!id) return null
  return getCart(id)
}

/** Ensure a cart exists and return its id, creating + persisting one if needed. */
async function ensureCartId(): Promise<string> {
  const existing = await readCartId()
  if (existing) {
    const cart = await getCart(existing)
    if (cart) return existing
  }
  const cart = await createCart()
  await writeCartId(cart.id)
  return cart.id
}

export async function addToCart(variantId: string, quantity = 1): Promise<Cart> {
  const id = await ensureCartId()
  const cart = await addLineItem(id, variantId, quantity)
  revalidatePath("/cart")
  return cart
}

export async function setLineQuantity(lineId: string, quantity: number): Promise<Cart | null> {
  const id = await readCartId()
  if (!id) return null
  const cart = quantity <= 0 ? await removeLineItem(id, lineId) : await updateLineItem(id, lineId, quantity)
  revalidatePath("/cart")
  return cart
}

export async function removeFromCart(lineId: string): Promise<Cart | null> {
  const id = await readCartId()
  if (!id) return null
  const cart = await removeLineItem(id, lineId)
  revalidatePath("/cart")
  return cart
}
