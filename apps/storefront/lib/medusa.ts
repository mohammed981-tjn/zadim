/**
 * زادم — Medusa v2 store API client.
 *
 * The backend already exists. This module only performs HTTP calls against it.
 * No database, no ORM, no mock data. Every function either returns real data
 * or throws a MedusaError that pages translate into an honest Arabic state.
 *
 * All money fields returned by the API are INTEGER HALALAS.
 */

import type { Locale } from "@/lib/i18n"

const BASE_URL = process.env.NEXT_PUBLIC_MEDUSA_URL
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PK

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ProductImage {
  id: string
  url: string
}

export interface ProductVariant {
  id: string
  title: string
  /** Unit price in integer halalas. */
  price: number
  /** null/undefined => availability unknown; treat as available. */
  inventory_quantity?: number | null
  options?: Record<string, string>
}

export interface Product {
  id: string
  title: string
  handle: string
  subtitle?: string | null
  description?: string | null
  thumbnail?: string | null
  images?: ProductImage[]
  /** Lowest variant price in integer halalas, for grid display. */
  price?: number | null
  variants?: ProductVariant[]
}

export interface ProductCategory {
  id: string
  name: string
  handle: string
  description?: string | null
  thumbnail?: string | null
}

export interface CartLine {
  id: string
  title: string
  variant_title?: string | null
  thumbnail?: string | null
  quantity: number
  /** Unit price in integer halalas. */
  unit_price: number
  /** Line total in integer halalas. */
  total: number
  product_handle?: string | null
}

export interface Cart {
  id: string
  items: CartLine[]
  /** All totals in integer halalas. */
  item_total: number
  shipping_total: number
  tax_total: number
  discount_total: number
  total: number
}

export interface Quote {
  total: number
  item_total: number
  shipping_total: number
  tax_total: number
  discount_total: number
}

export interface Order {
  id: string
  display_id: number | string
  total: number
}

export interface ShippingOption {
  id: string
  name: string
  /** Amount in integer halalas. */
  amount: number
}

/* ------------------------------------------------------------------ */
/* Error                                                               */
/* ------------------------------------------------------------------ */

export class MedusaError extends Error {
  status: number
  code?: string
  /** Structured payload from a 409 (PRICE_CHANGED / OUT_OF_STOCK). */
  details?: any

  constructor(status: number, message: string, code?: string, details?: any) {
    super(message)
    this.name = "MedusaError"
    this.status = status
    this.code = code
    this.details = details
  }
}

/* ------------------------------------------------------------------ */
/* Core fetch                                                          */
/* ------------------------------------------------------------------ */

type FetchOptions = RequestInit & { revalidate?: number }

async function medusaFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  if (!BASE_URL || !PUBLISHABLE_KEY) {
    throw new MedusaError(
      0,
      "لم يتم ضبط اتصال المتجر بعد. تأكد من إعداد عنوان المتجر ومفتاح الوصول.",
      "MISSING_CONFIG",
    )
  }

  const { revalidate, headers, ...init } = opts

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-publishable-api-key": PUBLISHABLE_KEY,
        ...headers,
      },
      ...(revalidate !== undefined ? { next: { revalidate } } : {}),
    })
  } catch {
    throw new MedusaError(0, "تعذّر الوصول إلى المتجر. تحقّق من اتصالك ثم حاول مرة أخرى.", "NETWORK")
  }

  const raw = await res.text()
  let body: any = null
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }
  }

  if (!res.ok) {
    const err = body?.error ?? {}
    throw new MedusaError(
      res.status,
      err.message_ar || err.message || "حدث خطأ غير متوقع في المتجر.",
      err.code,
      err.details,
    )
  }

  return body as T
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

export type HomeBlock =
  | { id: string; type: "hero"; position: number; payload: HeroPayload }
  | { id: string; type: "product_grid"; position: number; payload: ProductGridPayload }
  | { id: string; type: "banner"; position: number; payload: BannerPayload }
  | { id: string; type: "categories"; position: number; payload: CategoriesPayload }
  | { id: string; type: "rich_text"; position: number; payload: RichTextPayload }
  | { id: string; type: string; position: number; payload: unknown }

export interface HeroPayload {
  title: string
  subtitle?: string
  image_url?: string
  cta_label?: string
  cta_href?: string
}
export interface ProductGridPayload {
  title?: string
  handles: string[]
}
export interface BannerPayload {
  title: string
  image_url?: string
  href?: string
}
export interface CategoriesPayload {
  title?: string
  category_ids: string[]
}
export interface RichTextPayload {
  title?: string
  body: string
}

/**
 * ⚠️ **لا ترتيبَ هنا.** الكتلُ تُعرض بالترتيب الذي جاءت به حرفياً.
 *
 * كانت هذه الدالةُ تُعيد الترتيبَ بـ`sort((a,b) => a.position - b.position)`
 * — ويبدو حارساً وهو **ستار**: القاعدةُ ترتّب أصلاً (`position` ثم `id`
 * لحسم التعادل)، فلو انكسر ترتيبُها يوماً لأعادت الواجهةُ ترتيبَه بنفسها
 * وأخفت العطل. وأسوأُ منه: التعادلُ يُحسم في القاعدة بالمعرّف، ولا يعرف
 * `sort` هنا تلك القاعدة — فيختلف ما يُرسم عمّا يراه المديرُ في لوحته.
 *
 * والمصدرُ واحدٌ للترتيب: القاعدة. (وبوّابةُ `verify-ui.mjs` تقابل
 * المرسومَ بالقادم كتلةً كتلة.)
 */
export async function getHome(locale: Locale): Promise<{ blocks: HomeBlock[] }> {
  const suffix = locale === "ar" ? "" : `?locale=${encodeURIComponent(locale)}`
  const data = await medusaFetch<{ blocks: HomeBlock[] }>(`/store/home${suffix}`, {
    revalidate: 60,
  })
  return { blocks: Array.isArray(data?.blocks) ? data.blocks : [] }
}

/* ------------------------------------------------------------------ */
/* Products & categories                                               */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **السعرُ لا يأتي إلا بطلبه — وغيابُه صامت.**
 *
 * `GET /store/products` بلا هذين المعاملين يُعيد المنتجَ كاملاً
 * **و`calculated_price: null`** ولا `inventory_quantity` أصلاً: لا خطأ،
 * ولا رمز حالةٍ يشكو، فقط حقلٌ فارغ. فبطاقةُ منتجٍ بلا سعرٍ تُرسم وكأن
 * كلَّ شيءٍ سليم. (قِيس على الخادم الحقيقي: بلا `region_id` سعرُ
 * السمّاعة `null`، ومعه `39900`.)
 *
 * و`region_id` شرطٌ لا زينة: السعرُ في Medusa يُحسب لمنطقةٍ وعملة، ولا
 * معنى لسعرٍ بلا منطقة.
 */
const PRODUCT_FIELDS = "*variants.calculated_price,+variants.inventory_quantity"

/**
 * المنطقةُ تُقرأ من الخادم لا تُكتب في الكود.
 *
 * ونُحفظ الوعدَ نفسَه لا نتيجتَه: نداءان متزامنان في أوّل طلبٍ يشتركان
 * في رحلةٍ واحدة بدل رحلتين.
 */
let regionPromise: Promise<string | null> | null = null

async function defaultRegionId(): Promise<string | null> {
  if (!regionPromise) {
    regionPromise = medusaFetch<{ regions: { id: string }[] }>("/store/regions", { revalidate: 3600 })
      .then((d) => d?.regions?.[0]?.id ?? null)
      .catch((err) => {
        // فشلٌ عابرٌ يجب ألّا يُثبَّت في الذاكرة إلى الأبد.
        regionPromise = null
        throw err
      })
  }
  return regionPromise
}

/** أرخصُ سعرٍ بين المتغيّرات — وهو ما تعرضه البطاقة بـ«يبدأ من». */
function lowestPrice(variants: ProductVariant[]): number | null {
  const prices = variants.map((v) => v.price).filter((p): p is number => typeof p === "number")
  return prices.length ? Math.min(...prices) : null
}

/**
 * يحوّل منتجَ Medusa الخام إلى الشكل الذي ترسمه الواجهة.
 *
 * وثلاثةُ فروقٍ لا تُرى إلا بمقابلة الردّ الحقيقي:
 * `calculated_price.calculated_amount` لا `price`، و`options` مصفوفةُ
 * قيمٍ لا خريطة، و`total` غائبٌ عن المنتج.
 */
function toProduct(raw: any): Product {
  const variants: ProductVariant[] = (raw?.variants ?? []).map((v: any) => ({
    id: v.id,
    title: v.title,
    price: v.calculated_price?.calculated_amount ?? null,
    inventory_quantity: v.manage_inventory === false ? null : v.inventory_quantity,
    options: Object.fromEntries(
      (v.options ?? []).map((o: any) => [o.option?.title ?? o.option_id, o.value])
    ),
  }))

  return {
    id: raw.id,
    title: raw.title,
    handle: raw.handle,
    subtitle: raw.subtitle,
    description: raw.description,
    thumbnail: raw.thumbnail,
    images: raw.images ?? [],
    price: lowestPrice(variants),
    variants,
  }
}

/**
 * 🔴 **لاحقةُ اللغة — واللغةُ الأصلُ لا تُرسَل.**
 *
 * المحتوى في القاعدة عربيٌّ، والإنجليزيةُ **إلباسٌ فوقه** يقوم به
 * وسيطٌ في الخلفية (`modules/catalog/overlay.ts`). فإرسالُ `locale=ar`
 * يعني استعلامَ جدولِ ترجمةٍ في **كل طلبٍ عربيّ** لنتيجةٍ فارغةٍ
 * دائماً — وجمهورُنا سعوديّ، أي الأغلبيةُ العظمى من الطلبات.
 *
 * وحذفُها ليس تحسيناً بل تعريفٌ: «بلا لغةٍ» تعني «كما هو في القاعدة».
 */
function localeQuery(locale: Locale): string {
  return locale === "ar" ? "" : `&locale=${encodeURIComponent(locale)}`
}

async function fetchProducts(query: string, revalidate: number, locale: Locale): Promise<any[]> {
  const region = await defaultRegionId()
  const qs = `${query}&fields=${encodeURIComponent(PRODUCT_FIELDS)}${region ? `&region_id=${region}` : ""}${localeQuery(locale)}`
  const data = await medusaFetch<{ products: any[] }>(`/store/products?${qs}`, { revalidate })
  return data?.products ?? []
}

export async function getProductByHandle(handle: string, locale: Locale): Promise<Product | null> {
  const products = await fetchProducts(`handle=${encodeURIComponent(handle)}&limit=1`, 60, locale)
  return products[0] ? toProduct(products[0]) : null
}

export async function getProductsByHandles(handles: string[], locale: Locale): Promise<Product[]> {
  if (!handles?.length) return []
  const qs = handles.map((h) => `handle[]=${encodeURIComponent(h)}`).join("&")
  const products = await fetchProducts(`${qs}&limit=${handles.length}`, 60, locale)
  // Preserve the handle order the block author chose.
  const byHandle = new Map(products.map((p) => [p.handle, toProduct(p)]))
  return handles.map((h) => byHandle.get(h)).filter((p): p is Product => Boolean(p))
}

export async function getCategoryByHandle(
  handle: string,
  locale: Locale,
): Promise<ProductCategory | null> {
  const data = await medusaFetch<{ product_categories: ProductCategory[] }>(
    `/store/product-categories?handle=${encodeURIComponent(handle)}&limit=1${localeQuery(locale)}`,
    { revalidate: 60 },
  )
  return data?.product_categories?.[0] ?? null
}

export async function getCategoriesByIds(ids: string[], locale: Locale): Promise<ProductCategory[]> {
  if (!ids?.length) return []
  const qs = ids.map((id) => `id[]=${encodeURIComponent(id)}`).join("&")
  const data = await medusaFetch<{ product_categories: ProductCategory[] }>(
    `/store/product-categories?${qs}&limit=${ids.length}${localeQuery(locale)}`,
    { revalidate: 60 },
  )
  const cats = data?.product_categories ?? []
  const byId = new Map(cats.map((c) => [c.id, c]))
  return ids.map((id) => byId.get(id)).filter((c): c is ProductCategory => Boolean(c))
}

export interface CategoryProductsResult {
  category: ProductCategory | null
  products: Product[]
  count: number
}

/**
 * ⚠️ **ولا تصفيةَ بالخصائص بعد — وهذا مقصودٌ ومكتوب.**
 *
 * كانت هذه الدالةُ تمرّر كلَّ معاملٍ في العنوان إلى `/store/products`
 * «ليفسّره الخادم». وهو لا يفسّره: Medusa **يرفض** المعاملَ الذي لا
 * يعرفه، فأوّلُ نقرةٍ على لونٍ كانت تُعيد ٤٠٠ لا نتائجَ مصفّاة.
 *
 * والخصائصُ نفسُها موجودةٌ في الخلفية (`GET /store/categories/:id/filters`
 * يُعيدها بأعدادها)، **ولا مسارَ يصفّي المنتجاتِ بها**. فلا تُرسم أدواتُ
 * تصفيةٍ لا تصفّي: زرٌّ لا يفعل شيئاً أسوأُ من غيابه، لأن الزائرَ يظنّ
 * المتجرَ خالياً من مقاسه وهو موجود.
 *
 * والمسارُ الناقص مسجَّلٌ في `dev-docs`/الخطوات المعلّقة للمرحلة ١٠.
 */
export async function getCategoryProducts(
  handle: string,
  locale: Locale,
): Promise<CategoryProductsResult> {
  const category = await getCategoryByHandle(handle, locale)
  if (!category) return { category: null, products: [], count: 0 }

  const products = await fetchProducts(
    `category_id[]=${encodeURIComponent(category.id)}&limit=48`,
    30,
    locale,
  )

  return { category, products: products.map(toProduct), count: products.length }
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ **واللغةُ تُلبَس على النتائج لا على المطابقة.**
 *
 * المطابقةُ تجري على النصّ العربيّ المفهرَس مهما كانت لغةُ الصفحة —
 * فزائرٌ إنجليزيٌّ يكتب `iPhone` يجده بالمرادفات (ADR-006)، ثم يُعرض
 * العنوانُ مترجَماً. والعكسُ — فهرسةُ الإنجليزيةِ وحدَها في `/en` —
 * يجعل نصفَ الكتالوج غيرَ قابلٍ للبحث لأن أكثرَه بلا ترجمة.
 */
export async function search(
  q: string,
  locale: Locale,
): Promise<{ products: { id: string; title: string; handle: string }[]; count: number }> {
  if (!q.trim()) return { products: [], count: 0 }
  // Send the raw query; the backend handles Arabic normalization.
  const data = await medusaFetch<{ products: { id: string; title: string; handle: string }[]; count: number }>(
    `/store/search?q=${encodeURIComponent(q)}${localeQuery(locale)}`,
    { revalidate: 0, cache: "no-store" },
  )
  return { products: data?.products ?? [], count: data?.count ?? 0 }
}

/* ------------------------------------------------------------------ */
/* Cart                                                                */
/* ------------------------------------------------------------------ */

/**
 * 🔴 **`item.total` غيرُ موجودٍ في ردّ السلّة** (قِيس: `None`).
 *
 * Medusa يُعيد `unit_price` و`quantity` ولا يُعيد مجموعَ السطر. وسطرٌ
 * مجموعُه `undefined` يُرسم فراغاً أو `NaN` — فيُحسب هنا مرّةً واحدةً
 * لكل قارئٍ للسلّة، بضربٍ صحيحٍ في الهللات لا بكسرٍ عشريّ (ADR-008).
 *
 * ولا يُلمس `item_total`/`total` القادمان من الخادم: هما مصدرُ الحقيقة،
 * وحاصلُ جمعِ السطور هنا لا يساويهما (الضريبةُ داخلَ أحدهما).
 */
function toCart(raw: any): Cart {
  return {
    ...raw,
    items: (raw?.items ?? []).map((it: any) => ({
      ...it,
      total: typeof it.total === "number" ? it.total : (it.unit_price ?? 0) * (it.quantity ?? 0),
    })),
  }
}

export async function createCart(): Promise<Cart> {
  const data = await medusaFetch<{ cart: any }>("/store/carts", {
    method: "POST",
    body: JSON.stringify({}),
    cache: "no-store",
  })
  return toCart(data.cart)
}

export async function getCart(id: string): Promise<Cart | null> {
  try {
    const data = await medusaFetch<{ cart: any }>(`/store/carts/${id}`, { cache: "no-store" })
    return data?.cart ? toCart(data.cart) : null
  } catch (err) {
    if (err instanceof MedusaError && err.status === 404) return null
    throw err
  }
}

export async function addLineItem(cartId: string, variantId: string, quantity: number): Promise<Cart> {
  const data = await medusaFetch<{ cart: any }>(`/store/carts/${cartId}/line-items`, {
    method: "POST",
    body: JSON.stringify({ variant_id: variantId, quantity }),
    cache: "no-store",
  })
  return toCart(data.cart)
}

export async function updateLineItem(cartId: string, lineId: string, quantity: number): Promise<Cart> {
  const data = await medusaFetch<{ cart: any }>(`/store/carts/${cartId}/line-items/${lineId}`, {
    method: "POST",
    body: JSON.stringify({ quantity }),
    cache: "no-store",
  })
  return toCart(data.cart)
}

export async function removeLineItem(cartId: string, lineId: string): Promise<Cart> {
  const data = await medusaFetch<{ cart?: any; parent?: any }>(`/store/carts/${cartId}/line-items/${lineId}`, {
    method: "DELETE",
    cache: "no-store",
  })
  // Medusa returns the updated parent cart under `parent`.
  return toCart(data.cart ?? data.parent)
}

/* ------------------------------------------------------------------ */
/* Quote & checkout                                                    */
/* ------------------------------------------------------------------ */

export async function getOrder(id: string): Promise<Order | null> {
  try {
    const data = await medusaFetch<{ order: Order }>(`/store/orders/${id}`, { cache: "no-store" })
    return data?.order ?? null
  } catch (err) {
    if (err instanceof MedusaError && err.status === 404) return null
    throw err
  }
}

export async function getShippingOptions(cartId: string): Promise<ShippingOption[]> {
  try {
    const data = await medusaFetch<{ shipping_options: ShippingOption[] }>(
      `/store/shipping-options?cart_id=${encodeURIComponent(cartId)}`,
      { cache: "no-store" },
    )
    return data?.shipping_options ?? []
  } catch (err) {
    // A missing address or region can make this fail; treat as "none available".
    if (err instanceof MedusaError && (err.status === 400 || err.status === 404)) return []
    throw err
  }
}

export async function addShippingMethod(cartId: string, optionId: string): Promise<Cart> {
  const data = await medusaFetch<{ cart: Cart }>(`/store/carts/${cartId}/shipping-methods`, {
    method: "POST",
    body: JSON.stringify({ option_id: optionId }),
    cache: "no-store",
  })
  return data.cart
}

/* ------------------------------------------------------------------ */
/* Customer account                                                    */
/* ------------------------------------------------------------------ */

export interface Customer {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
}

/** طلبٌ في قائمة «طلباتي» — ما يكفي للعرض، لا الطلبُ كاملاً. */
export interface OrderSummary {
  id: string
  display_id: number | string
  status: string
  created_at: string
  /** بالهللات. */
  total: number
  currency_code: string
}

/**
 * نداءُ مصادقةٍ أو نداءٌ برمز جلسة.
 *
 * ومفصولٌ عن `medusaFetch` لأنه يختلف في ثلاثة: يحمل `Authorization`،
 * ويقبل أن يكون بلا جسم (`GET`)، **ولا يُخبَّأ أبداً** — ردُّ
 * `‎/store/customers/me` يخصّ شخصاً بعينه، وتخبئتُه تعرضُه لغيره.
 */
export async function medusaAuth<T>(
  path: string,
  body?: unknown | null,
  token?: string,
): Promise<T> {
  return medusaFetch<T>(path, {
    method: body === undefined || body === null ? "GET" : "POST",
    ...(body === undefined || body === null ? {} : { body: JSON.stringify(body) }),
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    cache: "no-store",
  })
}

/* ------------------------------------------------------------------ */
/* National address                                                    */
/* ------------------------------------------------------------------ */

/**
 * العنوانُ الوطنيّ السعوديّ — ستّةُ حقولٍ إلزامية.
 *
 * 🔴 **وهذه الدالّةُ هي السلكُ الذي كان مقطوعاً**: كانت الشاشةُ تجمع
 * العنوانَ وتتركه في المتصفّح، فيُنشأ الطلبُ بلا عنوانٍ ولا بريد —
 * ولا أحدَ يعرف أين يُرسَل.
 */
export interface NationalAddressForm {
  first_name: string
  last_name: string
  phone: string
  building_number: string
  street: string
  district: string
  city: string
  postal_code: string
  additional_number: string
  short_address?: string
  email?: string
}

/** خطأُ حقلٍ واحد كما يُعيده الخادم. */
export interface AddressFieldError {
  field: string
  code: string
  message_ar: string
}

export type SaveAddressResult =
  | { ok: true }
  | { ok: false; message: string; fields: AddressFieldError[] }

export async function setCartAddress(
  cartId: string,
  form: NationalAddressForm,
  /** رمزُ الجلسة إن كان العميلُ داخلاً — يربط السلّةَ بحسابه. */
  token?: string | null,
): Promise<SaveAddressResult> {
  try {
    await medusaFetch(`/store/carts/${cartId}/address`, {
      method: "POST",
      body: JSON.stringify(form),
      cache: "no-store",
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    })
    return { ok: true }
  } catch (err) {
    if (err instanceof MedusaError && err.status === 400) {
      return {
        ok: false,
        message: err.message,
        // الخادمُ يُعيد **كلَّ** الأخطاء لا أوّلَها، فالنموذجُ يُعلّم
        // حقولَه مرّةً واحدة.
        fields: (err.details?.fields ?? []) as AddressFieldError[],
      }
    }
    return {
      ok: false,
      message: err instanceof MedusaError ? err.message : "تعذّر حفظ العنوان.",
      fields: [],
    }
  }
}

export async function quoteCart(cartId: string): Promise<Quote> {
  const data = await medusaFetch<{ quote: Quote }>(`/store/carts/${cartId}/quote`, {
    method: "POST",
    body: JSON.stringify({}),
    cache: "no-store",
  })
  return data.quote
}

export interface PriceChangedLine {
  title: string
  quantity: number
  quoted_unit_price: number
  current_unit_price: number
  difference: number
}
export interface OutOfStockLine {
  title: string
  short_by: number
}

/**
 * `PRICE_CHANGED` **حالتان لا واحدة** (انظر `checkout/orchestrate.ts`):
 *
 * ١) تغيّر سعرُ صنفٍ ⇒ `details.lines`.
 * ٢) تغيّر **المجموع** والأصنافُ كما هي (شحنٌ أو ضريبةٌ أو عرضٌ انتهى)
 *    ⇒ `details.quoted_total/current_total/difference` **بلا `lines`**.
 *
 * والثانيةُ كانت تصل الواجهةَ بمصفوفةٍ فارغة، فيُرسم صندوقٌ خالٍ تحت
 * عنوان «تغيّرت الأسعار»: العميلُ يُرفض ولا يُرى له سبب.
 */
export interface QuotedTotals {
  quoted_total: number
  current_total: number
  difference: number
}

export type CheckoutResult =
  | { ok: true; order: Order }
  | {
      ok: false
      code: "PRICE_CHANGED"
      message: string
      lines: PriceChangedLine[]
      totals?: QuotedTotals
    }
  | { ok: false; code: "OUT_OF_STOCK"; message: string; lines: OutOfStockLine[] }
  | { ok: false; code: "ERROR"; message: string }

/**
 * Confirm the order. The SAME idempotencyKey must be reused across retries so a
 * network retry can never create a second order.
 */
export async function checkoutCart(cartId: string, idempotencyKey: string): Promise<CheckoutResult> {
  try {
    const data = await medusaFetch<{ order: Order }>(`/store/carts/${cartId}/checkout`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({}),
      cache: "no-store",
    })
    return { ok: true, order: data.order }
  } catch (err) {
    if (err instanceof MedusaError && err.status === 409) {
      if (err.code === "PRICE_CHANGED") {
        const d = err.details ?? {}
        return {
          ok: false,
          code: "PRICE_CHANGED",
          message: err.message,
          lines: (d.lines ?? []) as PriceChangedLine[],
          totals:
            typeof d.current_total === "number"
              ? {
                  quoted_total: d.quoted_total,
                  current_total: d.current_total,
                  difference: d.difference,
                }
              : undefined,
        }
      }
      if (err.code === "OUT_OF_STOCK") {
        return {
          ok: false,
          code: "OUT_OF_STOCK",
          message: err.message,
          lines: (err.details?.lines ?? []) as OutOfStockLine[],
        }
      }
    }
    return {
      ok: false,
      code: "ERROR",
      message: err instanceof MedusaError ? err.message : "تعذّر إتمام الطلب. حاول مرة أخرى.",
    }
  }
}
