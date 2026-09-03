import { Star } from "lucide-react"
import type { ProductReview, ReviewSummary } from "@/lib/medusa"
import { digits } from "@/lib/money"
import { t, type Locale } from "@/lib/i18n"

/**
 * تقييماتُ منتج (بند ٢٣).
 *
 * ── ولا زرَّ «اكتب تقييماً» هنا ─────────────────────────────────
 *
 * لأن الكتابةَ **تشترط سطرَ طلبٍ بعينه** (`order_line_item_id`)، وهو
 * ما لا تعرفه صفحةُ المنتج. فموضعُ الكتابة صفحةُ الطلب في «حسابي»
 * حيث السطرُ معروف — وزرٌّ هنا يقود إلى نموذجٍ لا يستطيع الإرسال.
 *
 * وهذا ليس نقصاً بل نتيجةَ القيد: «لا تقييمَ بلا شراء» يعني أن
 * الكتابةَ تبدأ من الشراء لا من المنتج.
 */
export function ReviewList({
  locale,
  reviews,
  summary,
}: {
  locale: Locale
  reviews: ProductReview[]
  summary: ReviewSummary
}) {
  return (
    <section aria-labelledby="reviews-heading" className="mt-12 border-t border-border pt-8">
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <h2 id="reviews-heading" className="text-lg font-bold">
          {t(locale, "review.title")}
        </h2>
        {summary.count > 0 ? (
          <p className="flex items-baseline gap-1.5 text-sm text-muted-foreground">
            <Stars value={Math.round(summary.average ?? 0)} />
            <span className="tabular font-medium text-foreground">
              {digits(locale, String(summary.average ?? 0))}
            </span>
            <span>{t(locale, "review.of")}</span>
            <span className="tabular">
              · {t(locale, "review.count", { count: digits(locale, String(summary.count)) })}
            </span>
          </p>
        ) : null}
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t(locale, "review.none")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t(locale, "review.noneHint")}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-xl border border-border p-4">
              <div className="mb-2 flex items-center gap-2">
                <Stars value={r.rating} />
                <span className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
                    dateStyle: "medium",
                  }).format(new Date(r.created_at))}
                </span>
              </div>
              {r.body ? (
                <p className="text-sm leading-relaxed text-pretty">{r.body}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * النجومُ صورةٌ للرقم لا بديلٌ عنه.
 *
 * فالرقمُ يُقرأ لقارئ الشاشة (`aria-label`)، والنجومُ مخفيّةٌ عنه:
 * خمسةُ رموزٍ تُقرأ واحداً واحداً ضجيجٌ لا معلومة.
 */
function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value}/5`} role="img">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden
          className={`size-3.5 ${i <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
        />
      ))}
    </span>
  )
}
