import Link from "next/link"
import Image from "next/image"
import { Heart } from "lucide-react"
import type { WishlistEntry } from "@/lib/medusa"
import { t, type Locale } from "@/lib/i18n"
import { FavoriteButton } from "./favorite-button"

/**
 * قائمةُ المفضّلة في «حسابي».
 *
 * وخادميّةٌ عمداً: لا حالةَ فيها سوى ما يأتي من الخادم، وزرُّ الإزالة
 * وحدَه عميلٌ. فصفحةٌ كاملةُ العميل تعني جلبَ القائمة مرّتين — مرّةً
 * للرسم الأوّل ومرّةً في المتصفّح.
 */
export function FavoritesList({
  locale,
  items,
}: {
  locale: Locale
  items: WishlistEntry[]
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <Heart className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t(locale, "wishlist.empty")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(locale, "wishlist.emptyHint")}</p>
      </div>
    )
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-center gap-3 rounded-xl border border-border p-3"
        >
          <Link
            href={`/${locale}/p/${item.handle}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            {item.thumbnail ? (
              <Image
                src={item.thumbnail}
                alt=""
                width={48}
                height={48}
                className="size-12 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="size-12 shrink-0 rounded-lg bg-muted" aria-hidden />
            )}
            <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
          </Link>
          <FavoriteButton
            productId={item.product_id}
            locale={locale}
            initiallySaved
            signedIn
            variantId={item.variant_id}
            className="shrink-0"
          />
        </li>
      ))}
    </ul>
  )
}
