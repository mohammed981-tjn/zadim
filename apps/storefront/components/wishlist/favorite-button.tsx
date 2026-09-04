"use client"

import { useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Heart } from "lucide-react"
import { addFavorite, removeFavorite } from "@/lib/auth-actions"
import { t, type Locale } from "@/lib/i18n"

/**
 * زرُّ المفضّلة (بند ٢٢).
 *
 * ── ولماذا يُعرض للضيف أيضاً ─────────────────────────────────────
 *
 * لأن إخفاءَه عمّن ليس داخلاً يُخفي **وجودَ الميزة** نفسِها: الضيفُ لا
 * يعرف أن للمتجر مفضّلةً تتابع الأسعار، فلا سببَ عنده لإنشاء حساب.
 * فيُعرض، والضغطةُ تقوده إلى الدخول ومعها سببُها.
 *
 * ⚠️ **ولا يُحفظ للضيف في كعكة.** ونصُّ البند «المفضّلة **تعرف انخفاض
 * السعر**»، والخبرُ يحتاج بريداً يصله. فمفضّلةٌ عند ضيفٍ بلا بريدٍ
 * تُرضي نصفَ الميزة وتُسقط نصفَها الذي يهمّ — ثم يظنّ صاحبُها أنه
 * مشترِكٌ في تنبيهٍ لن يصله.
 *
 * والحالةُ متفائلةٌ لنفس سبب لوح التصفية: زرٌّ لا يستجيب حتى يردّ
 * الخادم يُضغط مرّتين فيُلغى أثرُه.
 */
export function FavoriteButton({
  productId,
  locale,
  initiallySaved,
  signedIn,
  variantId,
  className,
}: {
  productId: string
  locale: Locale
  initiallySaved: boolean
  signedIn: boolean
  variantId?: string | null
  className?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useOptimistic(initiallySaved, (_prev, next: boolean) => next)

  const label = t(locale, saved ? "wishlist.remove" : "wishlist.add")

  return (
    <button
      type="button"
      // الاسمُ المعروض هو الفعلُ لا الحال: قارئُ الشاشة يقول «أضف إلى
      // المفضّلة» فيعرف ما سيقع، لا «مفضّل» فيحتار.
      aria-label={label}
      title={label}
      aria-pressed={saved}
      disabled={isPending}
      onClick={() => {
        if (!signedIn) {
          router.push(`/${locale}/account/login`)
          return
        }
        startTransition(async () => {
          setSaved(!saved)
          const res = saved
            ? await removeFavorite(productId)
            : await addFavorite(productId, variantId)
          if (!res.ok && res.needsSignIn) router.push(`/${locale}/account/login`)
          router.refresh()
        })
      }}
      className={`inline-flex size-9 items-center justify-center rounded-full border border-border bg-background/80 backdrop-blur transition-colors hover:border-primary disabled:opacity-60 ${className ?? ""}`}
    >
      <Heart
        className={`size-4 transition-colors ${saved ? "fill-destructive text-destructive" : "text-muted-foreground"}`}
        aria-hidden
      />
    </button>
  )
}
