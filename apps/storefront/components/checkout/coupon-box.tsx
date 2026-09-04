"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { applyCoupon, dropCoupon } from "@/lib/checkout-actions"
import { t, type Locale } from "@/lib/i18n"

/**
 * خانةُ رمز الخصم.
 *
 * ── ولماذا رسالةُ الخادم تُعرض كما هي ───────────────────────────
 *
 * الخادمُ يعرف السببَ: منتهٍ · لا ينطبق على هذه السلّة · استُعمل من
 * قبل · فوق سقفه · يحتاج حساباً. وصياغةٌ عامّةٌ («رمزٌ غيرُ صالح»)
 * تُخفي الفرقَ بين ما يُصلحه العميلُ بنفسه وما لا يُصلحه — فيُعيد
 * كتابةَ رمزٍ صحيحٍ عشرَ مرّاتٍ ثم يغادر.
 *
 * ── والصفحةُ تُحدَّث بعد كل نجاح ────────────────────────────────
 *
 * لأن المجاميعَ تُقرأ من الخادم (`ADR-003`: صفرُ منطقٍ في الواجهة)،
 * فرقمٌ يُحسب هنا بعد الخصم قد يخالف ما يُحصَّل — وهو أسوأُ من انتظار
 * لحظة.
 */
export function CouponBox({
  locale,
  appliedCode,
  disabled,
}: {
  locale: Locale
  appliedCode?: string | null
  disabled?: boolean
}) {
  const router = useRouter()
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = () => {
    const trimmed = code.trim()
    if (!trimmed) return
    setError(null)
    startTransition(async () => {
      const res = await applyCoupon(trimmed)
      if (res.ok) {
        setCode("")
        router.refresh()
      } else {
        setError(res.message)
      }
    })
  }

  const drop = () => {
    setError(null)
    startTransition(async () => {
      await dropCoupon()
      router.refresh()
    })
  }

  if (appliedCode) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3 text-sm">
        <span className="tabular">
          {t(locale, "coupon.applied")} <strong>{appliedCode}</strong>
        </span>
        <Button variant="ghost" size="sm" onClick={drop} disabled={pending || disabled}>
          {t(locale, "coupon.remove")}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={t(locale, "coupon.placeholder")}
          aria-label={t(locale, "coupon.label")}
          // الرموزُ تُكتب بالحروف اللاتينية دائماً — والاتجاهُ يُثبَّت
          // كي لا ينقلب النصُّ في صفحةٍ عربية.
          dir="ltr"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm uppercase"
          disabled={pending || disabled}
        />
        <Button onClick={submit} disabled={pending || disabled || !code.trim()}>
          {pending ? t(locale, "coupon.applying") : t(locale, "coupon.apply")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
