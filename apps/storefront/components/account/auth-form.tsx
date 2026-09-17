"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { register, signIn } from "@/lib/auth-actions"
import { t, type Locale } from "@/lib/i18n"

/**
 * نموذجُ الدخول والتسجيل — واحدٌ لهما.
 *
 * والفرقُ بينهما ثلاثةُ حقولٍ وزرٌّ، لا شاشتان: نسخُ النموذج مرّتين
 * يعني قاعدتَي تحقّقٍ تفترقان يوماً، وأشدَّهما تساهلاً هي التي تُصدَّق.
 */
export function AuthForm({ locale, mode }: { locale: Locale; mode: "signin" | "register" }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({
    email: "",
    password: "",
    first_name: "",
    last_name: "",
    phone: "",
  })

  const isRegister = mode === "register"

  const filled = Boolean(
    form.email.trim() &&
      form.password.trim() &&
      (!isRegister || (form.first_name.trim() && form.last_name.trim())),
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const res = isRegister
        ? await register({
            email: form.email,
            password: form.password,
            first_name: form.first_name,
            last_name: form.last_name,
            phone: form.phone || undefined,
          })
        : await signIn(form.email, form.password)

      if (!res.ok) {
        setError(res.message)
        return
      }
      router.push(`/${locale}/account`)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {isRegister ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t(locale, "checkout.firstName")}
            value={form.first_name}
            onChange={(v) => setForm((f) => ({ ...f, first_name: v }))}
            autoComplete="given-name"
          />
          <Input
            label={t(locale, "checkout.lastName")}
            value={form.last_name}
            onChange={(v) => setForm((f) => ({ ...f, last_name: v }))}
            autoComplete="family-name"
          />
          <div className="sm:col-span-2">
            <Input
              label={t(locale, "account.phoneOptional")}
              value={form.phone}
              onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              type="tel"
              autoComplete="tel"
            />
          </div>
        </div>
      ) : null}

      <Input
        label={t(locale, "account.email")}
        value={form.email}
        onChange={(v) => setForm((f) => ({ ...f, email: v }))}
        type="email"
        autoComplete="email"
        inputMode="email"
        enterKeyHint="next"
      />
      <Input
        label={t(locale, "account.password")}
        value={form.password}
        onChange={(v) => setForm((f) => ({ ...f, password: v }))}
        type={showPassword ? "text" : "password"}
        autoComplete={isRegister ? "new-password" : "current-password"}
        enterKeyHint="go"
        /*
         * 🔴 إظهارُ كلمة المرور ليس ترفاً على الجوّال.
         *
         * لوحةُ مفاتيح الهاتف تُخفي الحرفَ بعد لحظة، وكلمةٌ قويّةٌ فيها
         * رموزٌ تُكتب خطأً مرّتين وثلاثاً. والبديلُ الذي يختاره الناسُ
         * حين يعجزون **كلمةٌ أضعف**، لا محاولةٌ أدقّ. فالعينُ هنا تزيد
         * الأمانَ ولا تنقصه.
         */
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={t(locale, showPassword ? "account.hidePassword" : "account.showPassword")}
            aria-pressed={showPassword}
            className="flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
          >
            {showPassword ? (
              <EyeOff className="size-5" aria-hidden="true" />
            ) : (
              <Eye className="size-5" aria-hidden="true" />
            )}
          </button>
        }
      />

      {/* الخطأُ في منطقةٍ حيّة: قارئُ الشاشة يعلنه دون أن يفقد المستخدمُ
          موضعَه في النموذج. */}
      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="h-12 w-full text-base" disabled={!filled || pending}>
        {pending
          ? t(locale, "account.working")
          : isRegister
            ? t(locale, "account.createAccount")
            : t(locale, "account.signIn")}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {isRegister ? t(locale, "account.haveAccount") : t(locale, "account.noAccount")}{" "}
        <Link
          href={`/${locale}/account/${isRegister ? "login" : "register"}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {isRegister ? t(locale, "account.signIn") : t(locale, "account.createAccount")}
        </Link>
      </p>
    </form>
  )
}

/**
 * الحقل — **و`h-12` و`text-base` ليسا ذوقاً**.
 *
 * ارتفاعُ ٤٨ بكسل هو أصغرُ هدفِ لمسٍ توصي به إرشاداتُ المنصّتين، ودونه
 * تُخطئ الأصابعُ الكبيرة. و`text-base` (١٦ بكسل) أصغرُ قياسٍ **لا
 * يُكبّر معه iOS الصفحةَ تلقائياً عند التركيز** — وتكبيرٌ مفاجئٌ عند
 * أوّل حقلٍ يكسر الإيهامَ بأنه تطبيق، ويترك الزائرَ في صفحةٍ مزاحة.
 */
function Input({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
  enterKeyHint,
  trailing,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  autoComplete?: string
  inputMode?: "email" | "tel" | "text"
  enterKeyHint?: "next" | "go" | "done"
  trailing?: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <span className="relative flex items-center">
        <input
          type={type}
          value={value}
          autoComplete={autoComplete}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          onChange={(e) => onChange(e.target.value)}
          className={`h-12 w-full rounded-xl border border-border bg-background px-4 text-base outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/30 ${
            trailing ? "pe-12" : ""
          }`}
        />
        {trailing ? <span className="absolute end-1">{trailing}</span> : null}
      </span>
    </label>
  )
}
