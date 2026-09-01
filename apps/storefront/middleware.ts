import { NextResponse, type NextRequest } from "next/server"
import { DEFAULT_LOCALE, LOCALES } from "@/lib/i18n"

/**
 * زائرٌ يفتح `/` أو `/cart` بلا لغةٍ يُحوَّل إلى لغته.
 *
 * ── ولماذا لا تُترك المسارات بلا لغةٍ أصلاً ─────────────────────
 *
 * لأن الصفحةَ الواحدةَ بعنوانين (`/cart` و`/ar/cart`) محتوىً مكرَّرٌ
 * لمحرّكات البحث، ورابطٌ يُشارَك لا يحمل لغةَ مُشارِكه. فلكلِّ لغةٍ
 * عنوانُها، ولا عنوانَ بلا لغة.
 *
 * ⚠️ **والافتراضُ العربية** لا لغةُ المتصفّح وحدَها: الجمهورُ سعوديّ،
 * ومتصفّحٌ إنجليزيُّ الإعدادِ في الرياض أمرٌ شائع. فتُقرأ رغبةُ الزائر
 * إن صرّح بها (`Accept-Language` يبدأ بـ`en`)، وإلا فالعربية.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) {
    return NextResponse.next()
  }

  const accept = req.headers.get("accept-language") ?? ""
  const wantsEnglish = /^\s*en\b/i.test(accept)
  const locale = wantsEnglish ? "en" : DEFAULT_LOCALE

  const url = req.nextUrl.clone()
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`
  return NextResponse.redirect(url)
}

export const config = {
  // كلُّ شيءٍ عدا ملفّات Next نفسِها وأصولِ الموقع.
  matcher: ["/((?!_next|favicon|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|webp|ico|txt|xml)).*)"],
}
