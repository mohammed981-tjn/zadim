"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Truck, MapPin, CreditCard, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Totals } from "@/components/totals"
import { Price } from "@/components/price"
import { PriceChangedPanel } from "@/components/checkout/price-changed-panel"
import { OutOfStockPanel } from "@/components/checkout/out-of-stock-panel"
import { listShippingOptions, requestQuote, selectShipping, confirmCheckout } from "@/lib/checkout-actions"
import { toArabicDigits } from "@/lib/money"
import type {
  Cart,
  Quote,
  ShippingOption,
  PriceChangedLine,
  OutOfStockLine,
  QuotedTotals,
} from "@/lib/medusa"

type Step = "address" | "shipping" | "payment"

const STEPS: { id: Step; label: string; icon: typeof MapPin }[] = [
  { id: "address", label: "العنوان", icon: MapPin },
  { id: "shipping", label: "الشحن", icon: Truck },
  { id: "payment", label: "الدفع", icon: CreditCard },
]

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `ck_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

export function CheckoutFlow({
  cart,
  shippingOptions,
}: {
  cart: Cart
  shippingOptions: ShippingOption[]
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>("address")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [address, setAddress] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    address_1: "",
    city: "",
    postal_code: "",
  })

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

  const addressValid = useMemo(
    () =>
      Boolean(
        address.first_name.trim() &&
          address.last_name.trim() &&
          address.phone.trim() &&
          address.address_1.trim() &&
          address.city.trim(),
      ),
    [address],
  )

  async function goToReview() {
    setPending(true)
    setError(null)
    try {
      if (shippingOptionId) await selectShipping(shippingOptionId)
      const q = await requestQuote()
      setQuote(q)
      setStep("payment")
    } catch {
      setError("تعذّر تسعير طلبك. حاول مرة أخرى.")
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
      setError("تعذّرت إعادة التسعير. حاول مرة أخرى.")
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
        router.push(`/orders/${res.order.id}/confirmation`)
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
      setError("تعذّر إتمام الطلب. حاول مرة أخرى.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0">
        <Stepper current={step} />

        <div className="mt-8">
          {step === "address" ? (
            <section aria-labelledby="address-heading" className="space-y-5">
              <h2 id="address-heading" className="text-lg font-bold">
                عنوان الشحن
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="الاسم الأول" value={address.first_name} onChange={(v) => setAddress((a) => ({ ...a, first_name: v }))} />
                <Field label="اسم العائلة" value={address.last_name} onChange={(v) => setAddress((a) => ({ ...a, last_name: v }))} />
                <Field label="رقم الجوال" value={address.phone} onChange={(v) => setAddress((a) => ({ ...a, phone: v }))} inputMode="tel" />
                <Field label="المدينة" value={address.city} onChange={(v) => setAddress((a) => ({ ...a, city: v }))} />
                <div className="sm:col-span-2">
                  <Field label="العنوان" value={address.address_1} onChange={(v) => setAddress((a) => ({ ...a, address_1: v }))} />
                </div>
                <Field label="الرمز البريدي" value={address.postal_code} onChange={(v) => setAddress((a) => ({ ...a, postal_code: v }))} inputMode="numeric" />
              </div>
              <Button type="button" className="h-11 px-6" disabled={!addressValid} onClick={() => setStep("shipping")}>
                متابعة إلى الشحن
              </Button>
            </section>
          ) : null}

          {step === "shipping" ? (
            <section aria-labelledby="shipping-heading" className="space-y-5">
              <h2 id="shipping-heading" className="text-lg font-bold">
                طريقة الشحن
              </h2>
              {shippingOptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد خيارات شحن متاحة لعنوانك حاليًا.</p>
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
                          {opt.amount === 0 ? "مجاني" : <Price halalas={opt.amount} />}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="h-11 px-6" onClick={() => setStep("address")}>
                  رجوع
                </Button>
                <Button type="button" className="h-11 px-6" disabled={!shippingOptionId || pending} onClick={goToReview}>
                  {pending ? "جارٍ التسعير…" : "مراجعة الطلب"}
                </Button>
              </div>
            </section>
          ) : null}

          {step === "payment" ? (
            <section aria-labelledby="payment-heading" className="space-y-5">
              <h2 id="payment-heading" className="text-lg font-bold">
                المراجعة والدفع
              </h2>

              {priceChanged ? (
                <PriceChangedPanel
                  message={priceChanged.message}
                  lines={priceChanged.lines}
                  totals={priceChanged.totals}
                  onReprice={reprice}
                  repricing={pending}
                />
              ) : null}
              {outOfStock ? <OutOfStockPanel message={outOfStock.message} lines={outOfStock.lines} /> : null}

              {quote ? (
                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm text-muted-foreground text-pretty">
                    بالضغط على «تأكيد الطلب» فإنك توافق على دفع الإجمالي الظاهر في ملخص الطلب.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-pretty">
                  {priceChanged
                    ? "تغيّر السعر — اضغط «أعِد التسعير» للاطلاع على الإجمالي الجديد قبل التأكيد."
                    : "أعِد التسعير للمتابعة."}
                </p>
              )}

              <div className="flex gap-3">
                <Button type="button" variant="outline" className="h-11 px-6" onClick={() => setStep("shipping")}>
                  رجوع
                </Button>
                <Button type="button" className="h-11 px-6" disabled={pending || !quote} onClick={confirm}>
                  {pending ? "جارٍ التأكيد…" : "تأكيد الطلب"}
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
          <h2 className="mb-4 text-base font-semibold">ملخص الطلب</h2>

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
              itemTotal={quote.item_total}
              shippingTotal={quote.shipping_total}
              taxTotal={quote.tax_total}
              discountTotal={quote.discount_total}
              total={quote.total}
            />
          ) : priceChanged || outOfStock ? (
            <p className="text-sm text-muted-foreground text-pretty">
              لم يعد هذا الملخّص سارياً. أعِد التسعير للاطلاع على الإجمالي الجديد قبل التأكيد.
            </p>
          ) : (
            <Totals
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

function Stepper({ current }: { current: Step }) {
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
            <span className={active ? "text-sm font-bold" : "text-sm text-muted-foreground"}>{s.label}</span>
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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  inputMode?: "text" | "tel" | "numeric"
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
      />
    </label>
  )
}
