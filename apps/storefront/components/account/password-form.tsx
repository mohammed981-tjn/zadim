"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { updatePassword } from "@/lib/auth-actions"
import { t, type Locale } from "@/lib/i18n"

/**
 * تغييرُ كلمة المرور.
 *
 * ⚠️ **والحقلُ الأوّل «الحاليّة» عمداً**: هو ما يفرّق بين تغييرِ كلمةِ
 * مرورٍ واستيلاءٍ على حساب. ومسارُ Medusa العامّ لا يسأله — فحارسُنا
 * هو الذي يسأله، والنموذجُ يعكس ذلك بدل أن يبدو حقلاً زائداً.
 */
export function PasswordForm({ locale }: { locale: Locale }) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setDone(false)

    // تطابقُ التأكيد يُفحص هنا لا في الخادم: الخادمُ لا يعرف نيّةَ
    // الكاتب، والخطأُ المطبعيُّ يُصلَح قبل أن يُرسَل لا بعده.
    if (next !== confirm) {
      setError(t(locale, "password.mismatch"))
      return
    }

    startTransition(async () => {
      const res = await updatePassword({ current_password: current, new_password: next })
      if (res.ok) {
        setCurrent("")
        setNext("")
        setConfirm("")
        setDone(true)
      } else {
        setError(res.message)
      }
    })
  }

  const field = "w-full rounded-md border bg-background px-3 py-2 text-sm"

  return (
    <form onSubmit={submit} className="max-w-sm space-y-3">
      <div>
        <label htmlFor="pw-current" className="mb-1 block text-sm">
          {t(locale, "password.current")}
        </label>
        <input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={field}
          required
        />
      </div>
      <div>
        <label htmlFor="pw-new" className="mb-1 block text-sm">
          {t(locale, "password.new")}
        </label>
        <input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={field}
          required
        />
      </div>
      <div>
        <label htmlFor="pw-confirm" className="mb-1 block text-sm">
          {t(locale, "password.confirm")}
        </label>
        <input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={field}
          required
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t(locale, "password.done")}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || !current || !next}>
        {pending ? t(locale, "password.saving") : t(locale, "password.save")}
      </Button>
    </form>
  )
}
