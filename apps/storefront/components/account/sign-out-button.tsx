"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { signOut } from "@/lib/auth-actions"
import { t, type Locale } from "@/lib/i18n"

export function SignOutButton({ locale }: { locale: Locale }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  return (
    <Button
      type="button"
      variant="outline"
      className="h-10"
      disabled={pending || busy}
      onClick={() => {
        setBusy(true)
        startTransition(async () => {
          await signOut()
          router.push(`/${locale}`)
          router.refresh()
        })
      }}
    >
      <LogOut className="size-4" aria-hidden />
      {t(locale, "account.signOut")}
    </Button>
  )
}
