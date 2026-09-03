"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import {
  MedusaError,
  addToWishlist,
  deleteSavedAddress,
  medusaAuth,
  myWishlist,
  removeFromWishlist,
  myAddresses,
  saveAddressToBook,
  type Customer,
  type NationalAddressForm,
  type OrderSummary,
  type SaveAddressBookResult,
  type SavedAddress,
  type WishlistEntry,
} from "@/lib/medusa"

/**
 * حسابُ العميل — التسجيلُ والدخولُ والجلسة (بند ٢١).
 *
 * ── لماذا الرمزُ في كعكةٍ `httpOnly` لا في `localStorage` ──────────
 *
 * `localStorage` يقرؤه أيُّ سكربتٍ يعمل في الصفحة. ورمزُ جلسةٍ يُقرأ
 * بسكربتٍ هو رمزٌ يُسرق بأوّل ثغرةِ حقنٍ في أيّ مكتبةٍ نستوردها.
 * والكعكةُ `httpOnly` لا يراها جافاسكربت أصلاً — والخادمُ وحدَه
 * يرسلها. وهو نفسُ ما فُعل بمعرّف السلّة (`cart-actions.ts`).
 *
 * ⚠️ **ولا يُخزَّن شيءٌ آخر**: لا اسمٌ ولا بريدٌ في كعكةٍ ثانية. كلُّ
 * ما يُعرض يُقرأ من الخادم برمزِ الجلسة — فبياناتٌ مُخبَّأةٌ في المتصفّح
 * تتقادم، ثم تُعرض للمستخدم على أنها حالُه اليوم.
 */

const SESSION = "zadim_session"

/** ثلاثون يوماً — كعمر كعكة السلّة، فلا يفترقان في التجربة. */
const MAX_AGE = 60 * 60 * 24 * 30

async function setSession(token: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: MAX_AGE,
  })
}

export async function readSession(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION)?.value ?? null
}

export async function isSignedIn(): Promise<boolean> {
  return Boolean(await readSession())
}

export type AuthResult = { ok: true } | { ok: false; message: string }

/**
 * تسجيلٌ جديد — خطوتان عند Medusa لا واحدة.
 *
 * `‎/auth/customer/emailpass/register` يُنشئ **هويّةَ دخول** ويُعيد رمزاً،
 * ثم `‎/store/customers` يُنشئ **العميل** نفسَه بذلك الرمز. وفصلُهما
 * مقصودٌ عند Medusa: الهويّةُ قد تُستعمل لممثّلين آخرين.
 *
 * ⚠️ **والخطوةُ الثانية لازمة**: من يقف عند الأولى يملك رمزاً صالحاً
 * **بلا عميلٍ خلفَه** — فيدخل ثم لا يجد حساباً، وهي حالٌ تبدو عطلاً
 * غامضاً. فإن سقطت الثانية تُقال الرسالةُ ولا يُحفظ الرمز.
 */
export async function register(input: {
  email: string
  password: string
  first_name?: string
  last_name?: string
  phone?: string
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase()
  try {
    const { token } = await medusaAuth<{ token: string }>(
      "/auth/customer/emailpass/register",
      { email, password: input.password },
    )

    await medusaAuth(
      "/store/customers",
      {
        email,
        first_name: input.first_name?.trim() || undefined,
        last_name: input.last_name?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
      },
      token,
    )

    // 🔴 **والرمزُ يُجدَّد بعد إنشاء العميل — ولولاه لانكسر كلُّ حساب.**
    //
    // رمزُ التسجيل يحمل **هويّةَ دخولٍ بلا عميلٍ خلفَها**، فهو يصلح
    // لإنشاء العميل ولا يصلح لشيءٍ بعده: قِيس أن
    // `‎/store/customers/me` يردّه **401** حتى بعد نجاح الإنشاء.
    //
    // وأثرُه لو تُرك: التسجيلُ ينجح، ثم تردّ صفحةُ «حسابي» صاحبَها إلى
    // الدخول **إلى الأبد** — عطلٌ لا يشكو منه شيء، ويبدو للمستخدم أن
    // حسابه لم يُنشأ. وبعد التجديد يعمل `‎/me` فوراً (مقيس).
    const fresh = await medusaAuth<{ token: string }>("/auth/token/refresh", {}, token)

    await setSession(fresh.token || token)
    revalidatePath("/", "layout")
    return { ok: true }
  } catch (err) {
    return { ok: false, message: authMessage(err, "تعذّر إنشاء الحساب.") }
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const { token } = await medusaAuth<{ token: string }>("/auth/customer/emailpass", {
      email: email.trim().toLowerCase(),
      password,
    })
    await setSession(token)
    revalidatePath("/", "layout")
    return { ok: true }
  } catch (err) {
    return { ok: false, message: authMessage(err, "تعذّر تسجيل الدخول.") }
  }
}

export async function signOut(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION)
  revalidatePath("/", "layout")
}

/**
 * رسالةٌ يفهمها المستخدم.
 *
 * 🔴 **ولا تُفصّل عند الدخول**: «البريدُ غيرُ مسجَّل» و«كلمةُ المرور
 * خاطئة» رسالتان تكشفان **من له حسابٌ عندنا** لمن يجرّب قائمةَ بريد.
 * فالرسالةُ واحدةٌ لكليهما.
 */
function authMessage(err: unknown, fallback: string): string {
  if (err instanceof MedusaError) {
    if (err.status === 401) return "البريد الإلكتروني أو كلمة المرور غير صحيحة."
    if (err.status === 429) return "محاولاتٌ كثيرة. انتظر دقيقة ثم أعِد المحاولة."
    if (err.status === 400 || err.status === 422) {
      return err.message || "راجع البيانات المُدخلة."
    }
  }
  return fallback
}

/** بيانات العميل الحالي — أو `null` إن لم يكن داخلاً (أو انتهت جلسته). */
export async function currentCustomer(): Promise<Customer | null> {
  const token = await readSession()
  if (!token) return null
  try {
    const data = await medusaAuth<{ customer: Customer }>("/store/customers/me", null, token)
    return data.customer ?? null
  } catch (err) {
    // 🔴 جلسةٌ منتهيةٌ تُنظَّف ولا تُترك: كعكةٌ ميتةٌ تُبقي رابطَ
    // «حسابي» ظاهراً في كل صفحة، فيضغطه المستخدمُ ويُردّ إلى الدخول
    // كل مرّة بلا أن يفهم لماذا.
    if (err instanceof MedusaError && (err.status === 401 || err.status === 404)) {
      await signOut()
    }
    return null
  }
}

/** طلباتُ العميل — الأحدثُ أولاً. */
export async function myOrders(): Promise<OrderSummary[]> {
  const token = await readSession()
  if (!token) return []
  try {
    const data = await medusaAuth<{ orders: OrderSummary[] }>(
      "/store/orders?order=-created_at&limit=50",
      null,
      token,
    )
    return data.orders ?? []
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ */
/* دفترُ العناوين                                                      */
/* ------------------------------------------------------------------ */

/**
 * عناوينُ العميل المحفوظة — أو قائمةٌ فارغةٌ لمن ليس داخلاً.
 *
 * ولا تُرمى للضيف: شاشةُ الإتمام تناديها في كل مرّة، والضيفُ مسارٌ
 * كاملُ الحقوق لا حالةَ خطأ (بند ٨).
 */
export async function savedAddresses(): Promise<SavedAddress[]> {
  const token = await readSession()
  if (!token) return []
  return myAddresses(token)
}

/**
 * حفظُ عنوانٍ في الحساب.
 *
 * ⚠️ **ولا يُنادى إلا بطلبِ العميل صراحةً.** حفظُ كلِّ عنوانٍ يُكتب في
 * الإتمام تلقائياً يملأ دفترَه بعناوينِ أصدقاءَ وهدايا أرسلها مرّةً —
 * ثم يعجز عن تمييزها. والخانةُ في النموذج غيرُ مؤشَّرةٍ افتراضاً.
 */
export async function saveAddress(form: NationalAddressForm): Promise<SaveAddressBookResult> {
  const token = await readSession()
  if (!token) {
    return { ok: false, message: "سجّلِ الدخولَ أوّلاً.", fields: [] }
  }
  const res = await saveAddressToBook(form, token)
  if (res.ok) revalidatePath("/", "layout")
  return res
}

export async function removeAddress(id: string): Promise<boolean> {
  const token = await readSession()
  if (!token) return false
  const ok = await deleteSavedAddress(id, token)
  if (ok) revalidatePath("/", "layout")
  return ok
}

/* ------------------------------------------------------------------ */
/* المفضّلة                                                            */
/* ------------------------------------------------------------------ */

/**
 * مفضّلةُ العميل — أو قائمةٌ فارغةٌ لمن ليس داخلاً.
 *
 * ⚠️ **ولا مفضّلةَ للضيف.** ولها سببٌ يتجاوز الكسل: نصُّ بند ٢٢ أن
 * «**المفضّلة تعرف انخفاض السعر**»، والخبرُ يحتاج بريداً يصله. ومفضّلةٌ
 * في كعكةٍ عند ضيفٍ لا بريدَ له تُرضي نصفَ الميزة وتُسقط نصفَها الذي
 * يهمّ — ثم يظنّ صاحبُها أنه مشترِك.
 */
export async function myFavorites(): Promise<WishlistEntry[]> {
  const token = await readSession()
  if (!token) return []
  return myWishlist(token)
}

export type FavoriteResult = { ok: true } | { ok: false; needsSignIn: boolean }

export async function addFavorite(
  productId: string,
  variantId?: string | null,
): Promise<FavoriteResult> {
  const token = await readSession()
  if (!token) return { ok: false, needsSignIn: true }
  const ok = await addToWishlist(productId, token, variantId ?? null)
  if (ok) revalidatePath("/", "layout")
  return ok ? { ok: true } : { ok: false, needsSignIn: false }
}

export async function removeFavorite(productId: string): Promise<FavoriteResult> {
  const token = await readSession()
  if (!token) return { ok: false, needsSignIn: true }
  const ok = await removeFromWishlist(productId, token)
  if (ok) revalidatePath("/", "layout")
  return ok ? { ok: true } : { ok: false, needsSignIn: false }
}
