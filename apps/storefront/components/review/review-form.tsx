"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { writeReview } from "@/lib/auth-actions"
import { t, type Locale } from "@/lib/i18n"

/**
 * نموذجُ كتابة تقييم (بند ٢٣).
 *
 * ── وموضعُه صفحةُ الطلب لا صفحةُ المنتج ─────────────────────────
 *
 * لأن الكتابةَ **تشترط سطرَ طلبٍ بعينه** (`order_line_item_id`) — وهو
 * ما تعرفه صفحةُ الطلب وحدَها. وزرٌّ على صفحة المنتج يقود إلى نموذجٍ
 * لا يملك ما يُرسله، فيُردّ ٤٠٣ بلا سببٍ يفهمه صاحبُه.
 *
 * وهذا نتيجةُ القيد لا نقصٌ فيه: «لا تقييمَ بلا شراء» يعني أن الكتابةَ
 * **تبدأ من الشراء**.
 */
export function ReviewForm({
  locale,
  productId,
  lineItemId,
}: {
  locale: Locale
  productId: string
  lineItemId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState("")
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (result?.ok) {
    return (
      <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs">
        {result.message}
      </p>
    )
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const res = await writeReview(productId, {
            order_line_item_id: lineItemId,
            rating,
            body: body.trim() || undefined,
          })
          setResult({ ok: res.ok, message: res.message })
          if (res.ok) router.refresh()
        })
      }}
    >
      <div className="flex items-center gap-1" role="radiogroup" aria-label={t(locale, "review.title")}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={rating === i}
            aria-label={`${i}/5`}
            onClick={() => setRating(i)}
            className="rounded p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Star
              aria-hidden
              className={`size-5 ${i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
            />
          </button>
        ))}
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />

      {result && !result.ok ? (
        <p role="alert" className="text-xs text-destructive">
          {result.message}
        </p>
      ) : null}

      {/* الوعدُ يُقال **قبل** الإرسال لا بعده: من يضغط ويتوقّع ظهوراً
          فورياً ثم لا يجد تقييمَه يظنّ المتجرَ ابتلعه. */}
      <p className="text-xs text-muted-foreground">{t(locale, "review.pendingNote")}</p>

      <Button type="submit" className="h-9" disabled={rating === 0 || pending}>
        {pending ? t(locale, "account.working") : t(locale, "review.title")}
      </Button>
    </form>
  )
}
