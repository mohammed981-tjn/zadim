import Link from "next/link"
import { ArrowRight, ArrowLeft } from "lucide-react"
import { AuthForm } from "@/components/account/auth-form"
import { dirOf, t, type Locale } from "@/lib/i18n"

/**
 * شاشةُ الدخول والتسجيل — **شاشةٌ لا صفحة**.
 *
 * ── ما الفرق، ولماذا يستحقّ مكوّناً خاصّاً ──────────────────────
 *
 * صفحةُ الويب تُعرض داخل ترويسةٍ وتذييلٍ وشريطِ تبويب: حولها بحثٌ
 * وسلّةٌ وروابطُ سياساتٍ ولغةٌ تُبدَّل. وكلُّ ذلك **مخارجُ** من المهمّة
 * الوحيدة التي جاء لها الزائر. وشاشةُ الدخول في التطبيقات تُفرِغ ما
 * حولها عمداً: شعارٌ، وحقلان، وزرٌّ — ومخرجٌ واحدٌ معلَنٌ هو «تصفّح
 * بدون تسجيل».
 *
 * ── وكيف يختفي ما حولها بلا جافاسكربت ──────────────────────────
 *
 * بسِمة `data-auth-screen` وقاعدةِ `:has()` في `globals.css`. والبديلُ
 * المرفوض: تغليفُ الترويسة بمكوّنِ عميلٍ يقرأ المسار — فذاك يجعل
 * الترويسةَ تُحسب على الخادم في كلّ شاشةِ دخولٍ ثم تُرمى، ويُدخل
 * جافاسكربت في مسارٍ لا يحتاجه.
 *
 * ── والرجوعُ سهمٌ يتبع الاتجاه ──────────────────────────────────
 *
 * في RTL يشير السهمُ يميناً وفي LTR يساراً. وسهمٌ ثابتٌ يقول للعربيّ
 * «تقدّم» وهو يعني «ارجع».
 */
export function AuthScreen({
  locale,
  mode,
}: {
  locale: Locale
  mode: "signin" | "register"
}) {
  const isRegister = mode === "register"
  const Back = dirOf(locale) === "rtl" ? ArrowRight : ArrowLeft

  return (
    <div
      data-auth-screen
      /*
       * `100svh` لا `100vh`: على الجوّال يحسب `vh` الشاشةَ **بلا** شريط
       * المتصفّح، فتُدفع الحقولُ تحت الشريط ويُقصّ الزرّ. و`svh` أصغرُ
       * ارتفاعٍ ممكنٍ للنافذة — وهو ما يُرى فعلاً.
       */
      className="flex min-h-[100svh] flex-col px-6 pb-10"
      style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 1rem)" }}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <Link
          href={`/${locale}`}
          className="-ms-2 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t(locale, "account.back")}
        >
          <Back className="size-5" aria-hidden="true" />
        </Link>

        {/* الشعارُ يتوسّط ما بقي: مساحةٌ مرنةٌ فوق النموذج تدفعه إلى
            وسط الشاشة على الهواتف الطويلة، وتنكمش على القصيرة بدل أن
            تُخفي الزرَّ تحت الطيّة. */}
        <div className="flex flex-1 flex-col justify-center py-8">
          <div className="mb-8">
            <span className="text-4xl font-bold tracking-tight text-primary">
              {t(locale, "site.name")}
            </span>
            <h1 className="mt-6 text-2xl font-bold">
              {isRegister ? t(locale, "account.createAccount") : t(locale, "account.welcome")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isRegister ? t(locale, "account.registerLede") : t(locale, "account.signInLede")}
            </p>
          </div>

          <AuthForm locale={locale} mode={mode} />
        </div>

        {/* 🔴 مخرجٌ معلَنٌ للضيف — والمتجرُ يبيع بلا حساب.
            وشاشةُ دخولٍ بلا مخرجٍ تبدو **جداراً**: من لا يريد حساباً
            يظنّ أن لا سبيلَ إلى المنتجات فيغلق التطبيق. */}
        <Link
          href={`/${locale}/c/all`}
          className="mt-8 block text-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {t(locale, "account.browseAsGuest")}
        </Link>
      </div>
    </div>
  )
}
