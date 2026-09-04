"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Truck, MapPin, CreditCard, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Totals } from "@/components/totals"
import { Price } from "@/components/price"
import { PriceChangedPanel } from "@/components/checkout/price-changed-panel"
import { OutOfStockPanel } from "@/components/checkout/out-of-stock-panel"
import { requestQuote, saveAddress, selectShipping, confirmCheckout } from "@/lib/checkout-actions"
import { saveAddress as saveAddressToAccount } from "@/lib/auth-actions"
import { t, type Locale } from "@/lib/i18n"
import type {
  Cart,
  Quote,
  ShippingOption,
  PriceChangedLine,
  OutOfStockLine,
  QuotedTotals,
  SavedAddress,
} from "@/lib/medusa"

type Step = "address" | "shipping" | "payment"

const STEPS: { id: Step; labelKey: string; icon: typeof MapPin }[] = [
  { id: "address", labelKey: "checkout.stepAddress", icon: MapPin },
  { id: "shipping", labelKey: "checkout.stepShipping", icon: Truck },
  { id: "payment", labelKey: "checkout.stepPayment", icon: CreditCard },
]

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `ck_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function CheckoutFlow({
  cart,
  shippingOptions,
  savedAddresses = [],
  signedIn = false,
  locale,
}: {
  cart: Cart
  shippingOptions: ShippingOption[]
  /** عناوينُ الحساب — فارغةٌ للضيف **ولمن دخل ولم يحفظ بعد**. */
  savedAddresses?: SavedAddress[]
  /**
   * 🔴 **يُمرَّر صراحةً ولا يُشتقّ من طول القائمة.** فارغةٌ تعني
   * «ضيفٌ» أو «داخلٌ بلا عناوين» — وهما حالان مختلفتان: الثانيةُ هي
   * بالضبط من يريد حفظَ **أوّل** عنوانٍ له، ولو اشتُقّت لما رأى الخانةَ
   * أبداً فلا امتلأ دفترُه ولا رآها يوماً.
   */
  signedIn?: boolean
  locale: Locale
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>("address")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * حقولُ العنوان الوطنيّ السعوديّ (`06-saudi-layer.md` §٣).
   *
   * وكانت ستّةَ حقولٍ غربيّةٍ (`address_1` وحدَه بلا رقمِ مبنىً ولا حيٍّ
   * ولا رقمٍ إضافيّ) **تُجمع ولا تُرسَل**. والحيُّ أهمُّها للمندوب،
   * والرقمُ الإضافيُّ لا مقابلَ له في أيّ نموذجٍ عالميّ.
   */
  const [address, setAddress] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    building_number: "",
    street: "",
    district: "",
    city: "",
    postal_code: "",
    additional_number: "",
    short_address: "",
    email: "",
  })

  /** أخطاءُ الحقول كما يُعيدها الخادم — الحكمُ له لا للواجهة. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  /**
   * العنوانُ المختارُ من الدفتر — أو `null` لعنوانٍ جديد.
   *
   * 🔴 **والاختيارُ يملأ الحقولَ ولا يستبدلها.** لو أُرسل المعرّفُ إلى
   * الخادم بدل الحقول لصار للعنوان مصدران يفترقان: عنوانٌ يُحرَّر في
   * «حسابي» بعد اختياره هنا يغيّر وجهةَ طلبٍ قيد الإتمام. والحقولُ
   * المنسوخةُ لقطةٌ ثابتة، وهي ما يُفحص ويُخزَّن.
   */
  const [pickedId, setPickedId] = useState<string | null>(
    savedAddresses.find((a) => a.is_default)?.id ?? savedAddresses[0]?.id ?? null,
  )

  /**
   * حفظُ العنوان في الحساب — **غيرُ مؤشَّرٍ افتراضاً**.
   *
   * فحفظُ كلِّ عنوانٍ يُكتب يملأ دفترَ العميل بعناوينِ أصدقاءَ وهدايا
   * أرسلها مرّةً، ثم يعجز عن تمييزها. والاختيارُ له لا لنا.
   */
  const [saveToAccount, setSaveToAccount] = useState(false)

  /** نسخُ عنوانٍ محفوظٍ إلى الحقول — لقطةٌ لا إشارة. */
  function pick(a: SavedAddress) {
    setPickedId(a.id)
    setFieldErrors({})
    setAddress((prev) => ({
      ...prev,
      first_name: a.first_name,
      last_name: a.last_name,
      phone: a.phone,
      building_number: a.building_number,
      street: a.street,
      district: a.district,
      city: a.city,
      postal_code: a.postal_code,
      additional_number: a.additional_number,
      short_address: a.short_address ?? "",
    }))
  }

  const [shippingOptionId, setShippingOptionId] = useState<string>(shippingOptions[0]?.id ?? "")

  const [quote, setQuote] = useState<Quote | null>(null)
  const [priceChanged, setPriceChanged] = useState<{
    message: string
    lines: PriceChangedLine[]
    totals?: QuotedTotals
  } | null>(null)
  const [outOfStock, setOutOfStock] = useState<{ message: string; lines: OutOfStockLine[] } | null>(null)

  /**
   * 🔴 **عمرُ مفتاح التكرار — والخطُّ الفاصل بين حارسٍ وسجن.**
   *
   * المفتاحُ يمنع طلباً ثانياً حين تضيع الاستجابةُ ويُعيد العميلُ
   * الإرسال: **نفسُ النيّة ⇒ نفسُ المفتاح**. فيبقى ثابتاً عبر تعثّرِ
   * الشبكة والنقرةِ المزدوجة.
   *
   * لكنه كان ثابتاً **طولَ عمر الشاشة**، وهذا يسجن العميل. قِيس على
   * الخادم الحقيقي: مفتاحٌ سقطت محاولتُه يُعيد الخادمُ خطأها المخزّن
   * أبداً بـ`replayed: true` — حتى لسلّةٍ أخرى صالحة:
   *
   *     ١) سلّةٌ فارغة + مفتاح K  ⇒  400 CART_EMPTY
   *     ٢) سلّةٌ فيها منتج + K    ⇒  409 CART_EMPTY «replayed»
   *
   * فمَن رُفض بـ«تغيّر السعر» ثم قبِل السعرَ الجديد يضغط «تأكيد» فيُردّ
   * عليه بالرفض القديم نفسِه، مهما أعاد. سجنٌ لا حارس.
   *
   * فالمفتاحُ يُجدَّد **عند اتّفاقٍ جديد** لا غير: العميلُ رأى الفرقَ
   * وقبِل السعرَ الجديد ⇒ هذه نيّةٌ أخرى تستحقّ مفتاحاً آخر. أمّا
   * تعثّرُ الشبكة فيُعيد بنفس المفتاح، وهناك يعمل الحارسُ كما وُضع.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)

  /**
   * ⚠️ **تمكينُ الزرّ لا حكمُ صحّة.** الحكمُ عند الخادم
   * (`national-address.ts`) — وهو الوحيدُ الذي يعرف أن رقمَ المبنى
   * أربعةُ أرقامٍ والرمزَ البريديَّ خمسة. وتكرارُ القواعد هنا يعني
   * قاعدتين تفترقان يوماً، وأشدُّهما تساهلاً هي التي تُصدَّق.
   */
  const addressFilled = useMemo(
    () =>
      Boolean(
        address.first_name.trim() &&
          address.last_name.trim() &&
          address.phone.trim() &&
          address.building_number.trim() &&
          address.street.trim() &&
          address.district.trim() &&
          address.city.trim() &&
          address.postal_code.trim() &&
          address.additional_number.trim(),
      ),
    [address],
  )

  /**
   * يحفظ العنوانَ ثم ينتقل — **ولا ينتقل إن لم يُحفظ**.
   *
   * وكان الزرُّ `onClick={() => setStep("shipping")}` بلا نداءٍ أصلاً.
   */
  async function goToShipping() {
    setPending(true)
    setError(null)
    setFieldErrors({})
    try {
      const res = await saveAddress({
        first_name: address.first_name,
        last_name: address.last_name,
        phone: address.phone,
        building_number: address.building_number,
        street: address.street,
        district: address.district,
        city: address.city,
        postal_code: address.postal_code,
        additional_number: address.additional_number,
        short_address: address.short_address || undefined,
        email: address.email || undefined,
      })
      if (!res.ok) {
        setError(res.message)
        setFieldErrors(Object.fromEntries(res.fields.map((f) => [f.field, f.message_ar])))
        return
      }

      // ⚠️ **والحفظُ في الدفتر بعد حفظِ السلّة لا قبله، وسقوطُه لا
      // يوقف الشراء.** فالعنوانُ وصل حيث يهمّ — إلى الطلب. ومنعُ
      // عميلٍ من الشراء لأن دفترَ عناوينه امتلأ عقوبةٌ بلا ذنب.
      if (saveToAccount) {
        try {
          await saveAddressToAccount({
            first_name: address.first_name,
            last_name: address.last_name,
            phone: address.phone,
            building_number: address.building_number,
            street: address.street,
            district: address.district,
            city: address.city,
            postal_code: address.postal_code,
            additional_number: address.additional_number,
            short_address: address.short_address || undefined,
          })
        } catch {
          /* تجاهُلٌ مقصود — انظر أعلاه. */
        }
      }

      setStep("shipping")
    } catch {
      setError(t(locale, "checkout.addressFailed"))
    } finally {
      setPending(false)
    }
  }

  async function goToReview() {
    setPending(true)
    setError(null)
    try {
      if (shippingOptionId) await selectShipping(shippingOptionId)
      const q = await requestQuote()
      setQuote(q)
      setStep("payment")
    } catch {
      setError(t(locale, "checkout.quoteFailed"))
    } finally {
      setPending(false)
    }
  }

  async function reprice() {
    setPending(true)
    setError(null)
    setPriceChanged(null)
    try {
      const q = await requestQuote()
      setQuote(q)
      // عرضٌ جديدٌ ⇒ اتّفاقٌ جديدٌ ⇒ مفتاحٌ جديد. وبدونه يُعيد الخادمُ
      // رفضَ المحاولة السابقة إلى الأبد (انظر تعليقَ المفتاح أعلاه).
      setIdempotencyKey(newIdempotencyKey())
    } catch {
      setError(t(locale, "checkout.repriceFailed"))
    } finally {
      setPending(false)
    }
  }

  async function confirm() {
    setPending(true)
    setError(null)
    setPriceChanged(null)
    setOutOfStock(null)
    try {
      const res = await confirmCheckout(idempotencyKey)
      if (res.ok) {
        router.push(`/${locale}/orders/${res.order.id}/confirmation`)
        return
      }
      if (res.code === "PRICE_CHANGED") {
        // Never auto-accept — clear the agreed total and force a re-quote.
        setQuote(null)
        setPriceChanged({ message: res.message, lines: res.lines, totals: res.totals })
        return
      }
      if (res.code === "OUT_OF_STOCK") {
        setOutOfStock({ message: res.message, lines: res.lines })
        return
      }
      setError(res.message)
    } catch {
      setError(t(locale, "checkout.failed"))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0">
        <Stepper current={step} locale={locale} />

        <div className="mt-8">
          {step === "address" ? (
            <section aria-labelledby="address-heading" className="space-y-5">
              <h2 id="address-heading" className="text-lg font-bold">
                {t(locale, "checkout.addressHeading")}
              </h2>

              {/* دفترُ العناوين — لمن دخل وله عناوينُ محفوظة. ولا يُعرض
                  للضيف: صندوقٌ فارغٌ عنوانُه «عناوين محفوظة» يجعله
                  يبحث عمّا ليس له. */}
              {savedAddresses.length > 0 ? (
                <fieldset className="rounded-xl border border-border p-4">
                  <legend className="px-2 text-sm font-medium">
                    {t(locale, "account.savedAddresses")}
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {savedAddresses.map((a) => (
                      <label
                        key={a.id}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors ${
                          pickedId === a.id ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <input
                          type="radio"
                          name="saved-address"
                          className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                          checked={pickedId === a.id}
                          onChange={() => pick(a)}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {a.first_name} {a.last_name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {a.building_number} {a.street} — {a.district}, {a.city}
                          </span>
                        </span>
                      </label>
                    ))}
                    <label
                      className={`flex cursor-pointer gap-3 rounded-lg border border-dashed p-3 text-sm transition-colors ${
                        pickedId === null ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      <input
                        type="radio"
                        name="saved-address"
                        className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                        checked={pickedId === null}
                        onChange={() => setPickedId(null)}
                      />
                      <span className="font-medium">{t(locale, "account.newAddress")}</span>
                    </label>
                  </div>
                </fieldset>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t(locale, "checkout.firstName")} value={address.first_name} error={fieldErrors.first_name} onChange={(v) => setAddress((a) => ({ ...a, first_name: v }))} />
                <Field label={t(locale, "checkout.lastName")} value={address.last_name} error={fieldErrors.last_name} onChange={(v) => setAddress((a) => ({ ...a, last_name: v }))} />
                <Field label={t(locale, "checkout.phone")} value={address.phone} error={fieldErrors.phone} hint={t(locale, "checkout.phoneHint")} onChange={(v) => setAddress((a) => ({ ...a, phone: v }))} inputMode="tel" />
                <Field label={t(locale, "checkout.email")} value={address.email} error={fieldErrors.email} hint={t(locale, "checkout.emailHint")} onChange={(v) => setAddress((a) => ({ ...a, email: v }))} inputMode="text" />

                <Field label={t(locale, "checkout.buildingNumber")} value={address.building_number} error={fieldErrors.building_number} hint={t(locale, "checkout.fourDigits")} onChange={(v) => setAddress((a) => ({ ...a, building_number: v }))} inputMode="numeric" />
                <Field label={t(locale, "checkout.street")} value={address.street} error={fieldErrors.street} onChange={(v) => setAddress((a) => ({ ...a, street: v }))} />
                {/* الحيُّ أهمُّ حقلٍ للمندوب — ولذلك يسبق المدينة */}
                <Field label={t(locale, "checkout.district")} value={address.district} error={fieldErrors.district} onChange={(v) => setAddress((a) => ({ ...a, district: v }))} />
                <Field label={t(locale, "checkout.city")} value={address.city} error={fieldErrors.city} onChange={(v) => setAddress((a) => ({ ...a, city: v }))} />
                <Field label={t(locale, "checkout.postalCode")} value={address.postal_code} error={fieldErrors.postal_code} hint={t(locale, "checkout.fiveDigits")} onChange={(v) => setAddress((a) => ({ ...a, postal_code: v }))} inputMode="numeric" />
                <Field label={t(locale, "checkout.additionalNumber")} value={address.additional_number} error={fieldErrors.additional_number} hint={t(locale, "checkout.fourDigits")} onChange={(v) => setAddress((a) => ({ ...a, additional_number: v }))} inputMode="numeric" />
                <div className="sm:col-span-2">
                  <Field label={t(locale, "checkout.shortAddress")} value={address.short_address} error={fieldErrors.short_address} hint={t(locale, "checkout.shortAddressHint")} onChange={(v) => setAddress((a) => ({ ...a, short_address: v }))} />
                </div>
              </div>
              {/* الحفظُ خيارٌ صريحٌ لمن دخل — ولا يُعرض للضيف لأنه بلا
                  حسابٍ يُحفظ فيه، وخانةٌ لا تفعل شيئاً أسوأُ من غيابها. */}
              {signedIn ? (
                <label className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={saveToAccount}
                    onChange={(e) => setSaveToAccount(e.target.checked)}
                  />
                  {t(locale, "account.saveToAccount")}
                </label>
              ) : null}

              <Button type="button" className="h-11 px-6" disabled={!addressFilled || pending} onClick={goToShipping}>
                {pending ? t(locale, "checkout.savingAddress") : t(locale, "checkout.toShipping")}
              </Button>
            </section>
          ) : null}

          {step === "shipping" ? (
            <section aria-labelledby="shipping-heading" className="space-y-5">
              <h2 id="shipping-heading" className="text-lg font-bold">
                {t(locale, "checkout.shippingHeading")}
              </h2>
              {shippingOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t(locale, "checkout.noShipping")}</p>
              ) : (
                <ul className="space-y-3">
                  {shippingOptions.map((opt) => (
                    <li key={opt.id}>
                      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-4 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary">
                        <span className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="shipping"
                            className="size-4 accent-primary"
                            checked={shippingOptionId === opt.id}
                            onChange={() => setShippingOptionId(opt.id)}
                          />
                          <span className="text-sm font-medium">{opt.name}</span>
                        </span>
                        {/* `Price` لا حسابٌ هنا: `Math.floor(amount/100)`
                            كان يبتلع الهللات — «٢٥٫٧٥ ر.س» تُعرض «٢٥ ر.س»
                            ثم يُخصم الرقمُ الكامل. والتنسيقُ في مكانٍ
                            واحدٍ بحسابٍ صحيح (ADR-008). */}
                        <span className="text-sm text-muted-foreground">
                          {opt.amount === 0 ? t(locale, "totals.free") : <Price locale={locale} halalas={opt.amount} />}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="h-11 px-6" onClick={() => setStep("address")}>
                  {t(locale, "checkout.back")}
                </Button>
                <Button type="button" className="h-11 px-6" disabled={!shippingOptionId || pending} onClick={goToReview}>
                  {pending ? t(locale, "checkout.pricing") : t(locale, "checkout.review")}
                </Button>
              </div>
            </section>
          ) : null}

          {step === "payment" ? (
            <section aria-labelledby="payment-heading" className="space-y-5">
              <h2 id="payment-heading" className="text-lg font-bold">
                {t(locale, "checkout.reviewHeading")}
              </h2>

              {priceChanged ? (
                <PriceChangedPanel
                  locale={locale}
                  message={priceChanged.message}
                  lines={priceChanged.lines}
                  totals={priceChanged.totals}
                  onReprice={reprice}
                  repricing={pending}
                />
              ) : null}
              {outOfStock ? <OutOfStockPanel message={outOfStock.message} lines={outOfStock.lines} locale={locale} /> : null}

              {quote ? (
                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm text-muted-foreground text-pretty">
                    {t(locale, "checkout.agree")}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-pretty">
                  {priceChanged
                    ? t(locale, "checkout.repriceHint")
                    : t(locale, "checkout.repriceFirst")}
                </p>
              )}

              <div className="flex gap-3">
                <Button type="button" variant="outline" className="h-11 px-6" onClick={() => setStep("shipping")}>
                  {t(locale, "checkout.back")}
                </Button>
                <Button type="button" className="h-11 px-6" disabled={pending || !quote} onClick={confirm}>
                  {pending ? t(locale, "checkout.confirming") : t(locale, "checkout.confirm")}
                </Button>
              </div>
            </section>
          ) : null}

          {error ? (
            <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-semibold">{t(locale, "totals.title")}</h2>

          {/* 🔴 **ملخّصٌ باطلٌ لا يُعرض برقم.**
              كان الملخّصُ يرجع إلى مجاميع السلّة كلّما غاب العرض. والسلّةُ
              هنا مرسومةٌ من الخادم عند فتح الصفحة — قبل اختيار الشحن. فحين
              يُلغى العرضُ لتغيّر السعر يظهر «الشحن: مجاني» وإجماليٌّ **أقلُّ**
              من الذي وافق عليه العميلُ قبل ثانية (قِيس: ٤٨٧٫٦٠ ⇐ ٤٥٨٫٨٥).
              رقمٌ أدنى يظهر في لحظة الرفض بالذات أسوأُ ما يمكن عرضه: يبدو
              وعداً بسعرٍ أقلّ، وهو أثرُ بياناتٍ قديمة.
              فما ليس عرضاً سارياً لا يُعرض رقماً. */}
          {quote ? (
            <Totals
              locale={locale}
              itemTotal={quote.item_total}
              shippingTotal={quote.shipping_total}
              taxTotal={quote.tax_total}
              discountTotal={quote.discount_total}
              total={quote.total}
            />
          ) : priceChanged || outOfStock ? (
            <p className="text-sm text-muted-foreground text-pretty">
              {t(locale, "totals.stale")}
            </p>
          ) : (
            <Totals
              locale={locale}
              itemTotal={cart.item_total}
              shippingTotal={cart.shipping_total}
              taxTotal={cart.tax_total}
              discountTotal={cart.discount_total}
              total={cart.total}
            />
          )}
        </div>
      </aside>
    </div>
  )
}

function Stepper({ current, locale }: { current: Step; locale: Locale }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current)
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        const Icon = s.icon
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <span
              className={[
                "flex size-9 shrink-0 items-center justify-center rounded-full border text-sm",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground",
              ].join(" ")}
            >
              {done ? <Check className="size-4" /> : <Icon className="size-4" />}
            </span>
            <span className={active ? "text-sm font-bold" : "text-sm text-muted-foreground"}>{t(locale, s.labelKey)}</span>
            {i < STEPS.length - 1 ? <span className="mx-1 hidden h-px flex-1 bg-border sm:block" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

function Field({
  label,
  value,
  onChange,
  inputMode,
  hint,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  inputMode?: "text" | "tel" | "numeric"
  /** تلميحُ الصيغة — يُعرض دائماً، لا بعد الخطأ فقط. */
  hint?: string
  /** رسالةُ الخادم لهذا الحقل. */
  error?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={`h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-1 ${
          error
            ? "border-destructive focus:border-destructive focus:ring-destructive"
            : "border-border focus:border-primary focus:ring-primary"
        }`}
      />
      {/* الخطأُ يزيح التلميح: عرضُهما معاً يجعل القارئَ يقرأ الصيغةَ
          الصحيحة ويظنّها الشكوى. */}
      {error ? (
        <span className="mt-1 block text-xs text-destructive">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}
