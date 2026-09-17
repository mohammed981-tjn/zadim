"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, LayoutGrid, ShoppingBag, User } from "lucide-react"
import { t, type Locale } from "@/lib/i18n"

/**
 * شريطُ التبويب السفليّ — **ما يجعل الصفحةَ تبدو تطبيقاً**.
 *
 * ── لماذا سفليٌّ لا قائمةٌ في الترويسة ──────────────────────────
 *
 * لأن الإبهامَ يبلغ أسفلَ الشاشة ولا يبلغ أعلاها في هاتفٍ بستّ بوصات.
 * وقائمةٌ خلف زرٍّ في الأعلى تعني نقرتين لكلّ انتقال، ولا تقول للزائر
 * **أين هو**. والشريطُ يقول الاثنين: الوجهاتُ معروضةٌ دائماً، والنشطُ
 * منها ملوَّن.
 *
 * ── وأربعةٌ لا خمسة ─────────────────────────────────────────────
 *
 * البحثُ في الترويسة حيث لوحةُ المفاتيح، وإقحامُه تبويباً خامساً
 * يضيّق الأربعةَ الباقية ويكرّر ما هو ظاهر. والتبويبُ الخامسُ يُضاف
 * يومَ يوجد قسمٌ خامسٌ يستحقّه (المفضّلة حين تكبر).
 *
 * ── و`md:hidden` عمداً ──────────────────────────────────────────
 *
 * على سطح المكتب الترويسةُ تكفي والشريطُ السفليُّ يأكل ارتفاعاً بلا
 * فائدة — ولا فأرةَ تشتكي من بُعدِ الأعلى.
 */

type Tab = {
  href: (l: Locale) => string
  label: (l: Locale) => string
  icon: typeof Home
  /** هل هذا المسارُ هو التبويبَ النشط؟ */
  active: (path: string, l: Locale) => boolean
}

const TABS: Tab[] = [
  {
    href: (l) => `/${l}`,
    label: (l) => t(l, "nav.home"),
    icon: Home,
    // الرئيسيةُ **مطابقةٌ تامّة**: `startsWith` عليها يجعلها نشطةً في
    // كلّ صفحةٍ في الموقع، فيصير النشطُ بلا معنى.
    active: (p, l) => p === `/${l}` || p === `/${l}/`,
  },
  {
    href: (l) => `/${l}/c/all`,
    label: (l) => t(l, "nav.shop"),
    icon: LayoutGrid,
    // ويشمل صفحةَ المنتج والبحث: من فتح منتجاً فهو في التسوّق، وتبويبٌ
    // لا يُضيء في نصف رحلة الشراء يبدو معطوباً.
    active: (p, l) => p.startsWith(`/${l}/c/`) || p.startsWith(`/${l}/p/`) || p.startsWith(`/${l}/search`),
  },
  {
    href: (l) => `/${l}/cart`,
    label: (l) => t(l, "nav.cart"),
    icon: ShoppingBag,
    active: (p, l) => p.startsWith(`/${l}/cart`) || p.startsWith(`/${l}/checkout`),
  },
  {
    href: (l) => `/${l}/account`,
    label: (l) => t(l, "nav.account"),
    icon: User,
    active: (p, l) => p.startsWith(`/${l}/account`),
  },
]

export function BottomTabs({ locale }: { locale: Locale }) {
  const pathname = usePathname() ?? `/${locale}`

  return (
    <nav
      aria-label={t(locale, "nav.tabsAria")}
      /*
       * ⚠️ و`env(safe-area-inset-bottom)` ليست زينة: على هاتفٍ بشريطِ
       * إيماءاتٍ سفليّ يقع الشريطُ **تحت** الشريط الأسود، فتُنقر
       * الإيماءةُ بدل التبويب.
       */
      /*
       * 🔴 وخلفيّةٌ **معتمة** لا شفّافةٌ بضبابٍ خلفيّ.
       *
       * قِيس: بوّابةُ إتاحة الوصول ردّت `color-contrast` على تسميات
       * التبويبات غير النشطة — لأن الشريطَ الشفّافَ يُركّب لونَ النصّ
       * على **ما يمرّ تحته**، فالتباينُ يتغيّر مع كلّ تمريرة. وشريطُ
       * التبويب في التطبيقات معتمٌ أصلاً؛ والضبابُ زينةُ ويبٍ ثمنُها
       * هنا نصٌّ لا يُقرأ فوق صورةِ منتج.
       */
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      data-app-tabs
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map((tab) => {
          const isActive = tab.active(pathname, locale)
          const Icon = tab.icon
          return (
            <li key={tab.href(locale)} className="flex-1">
              <Link
                href={tab.href(locale)}
                // 🔴 `aria-current` لا اللونُ وحدَه: قارئُ الشاشة لا يرى
                // اللون، ومن يميّز الألوانَ بصعوبةٍ لا يراه أيضاً.
                aria-current={isActive ? "page" : undefined}
                className={`flex h-16 touch-manipulation select-none flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${
                  isActive ? "text-primary" : "text-foreground/70 hover:text-foreground"
                }`}
              >
                <Icon className="size-6" aria-hidden="true" strokeWidth={isActive ? 2.4 : 1.8} />
                <span>{tab.label(locale)}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
