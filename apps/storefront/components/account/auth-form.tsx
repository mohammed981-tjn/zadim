"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
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
      />
      <Input
        label={t(locale, "account.password")}
        value={form.password}
        onChange={(v) => setForm((f) => ({ ...f, password: v }))}
        type="password"
        autoComplete={isRegister ? "new-password" : "current-password"}
      />

      {/* الخطأُ في منطقةٍ حيّة: قارئُ الشاشة يعلنه دون أن يفقد المستخدمُ
          موضعَه في النموذج. */}
      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="h-11 w-full" disabled={!filled || pending}>
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

function Input({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  autoComplete?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
      />
    </label>
  )
}
