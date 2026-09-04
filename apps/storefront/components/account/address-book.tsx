"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MapPin, Trash2 } from "lucide-react"
import { removeAddress } from "@/lib/auth-actions"
import type { SavedAddress } from "@/lib/medusa"
import { t, type Locale } from "@/lib/i18n"

/**
 * دفترُ العناوين في «حسابي».
 *
 * ── ولماذا يُعرض العنوانُ مهيكلاً لا سطراً واحداً ────────────────
 *
 * لأن العميلَ يميّز عناوينَه بالحيّ ورقم المبنى، لا بالمدينة. وثلاثةُ
 * عناوينَ كلُّها «الرياض» في سطرٍ واحد لا تُميَّز — فيحذف الخطأ منها.
 */
export function AddressBook({
  locale,
  addresses,
}: {
  locale: Locale
  addresses: SavedAddress[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  if (addresses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <MapPin className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t(locale, "account.noAddresses")}</p>
      </div>
    )
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {addresses.map((a) => (
        <li key={a.id} className="rounded-xl border border-border p-4">
          <div className="mb-2 flex items-start justify-between gap-3">
            <span className="font-medium">
              {a.first_name} {a.last_name}
            </span>
            {a.is_default ? (
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs">
                {t(locale, "account.addressDefault")}
              </span>
            ) : null}
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {a.building_number} {a.street}
            <br />
            {a.district} — {a.city} {a.postal_code}
            <br />
            {/* الرقمُ الإضافيّ يُعرض: هو ما يميّز المدخلَ حين تتشابه
                المباني، والمندوبُ يسأل عنه. */}
            {a.additional_number} · {a.phone}
          </p>

          <button
            type="button"
            disabled={pending || busyId === a.id}
            onClick={() => {
              // تأكيدٌ قبل الحذف: زرٌّ صغيرٌ بجوار عنوانٍ صحيحٍ يُضغط
              // سهواً، وإعادةُ كتابة تسعة حقولٍ ثمنٌ غالٍ للسهو.
              if (!window.confirm(t(locale, "account.deleteAddressConfirm"))) return
              setBusyId(a.id)
              startTransition(async () => {
                await removeAddress(a.id)
                setBusyId(null)
                router.refresh()
              })
            }}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-destructive underline-offset-4 hover:underline disabled:opacity-50"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {t(locale, "account.deleteAddress")}
          </button>
        </li>
      ))}
    </ul>
  )
}
