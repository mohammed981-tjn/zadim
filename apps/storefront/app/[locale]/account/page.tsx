import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Package } from "lucide-react"
import { Container } from "@/components/container"
import { Price } from "@/components/price"
import { SignOutButton } from "@/components/account/sign-out-button"
import { currentCustomer, myOrders } from "@/lib/auth-actions"
import { digits } from "@/lib/money"
import { t, type Locale } from "@/lib/i18n"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  return { title: `${t(locale, "account.title")} — ${t(locale, "site.name")}` }
}

/**
 * حسابي — الملفُّ الشخصيُّ وسجلُّ الطلبات (بند ٢١).
 *
 * ── ولماذا سجلُّ الطلبات هنا لا صفحةٌ مستقلّة ────────────────────
 *
 * لأن سؤالَ العميل واحدٌ: «**أين طلبي؟**». وشاشةٌ اسمُها «حسابي» تعرض
 * اسمَه وبريدَه ولا تجيب سؤالَه تجعله يبحث عن الجواب في مكانٍ آخر —
 * ثم يسأل الدعم.
 *
 * ⚠️ **وحالاتُ الطلب تُترجَم ولا تُعرض خاماً**: `pending` كلمةٌ
 * إنجليزيةٌ تعني عند المبرمج «لم يُنفَّذ بعد» وتعني عند العميل «معلَّق»
 * — وهما ليسا واحداً.
 */

/** حالاتُ Medusa ⇒ ما يفهمه العميل. */
const STATUS_KEY: Record<string, string> = {
  pending: "order.statusPending",
  completed: "order.statusCompleted",
  canceled: "order.statusCanceled",
  archived: "order.statusArchived",
  requires_action: "order.statusAction",
  draft: "order.statusDraft",
}

export default async function AccountPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  const customer = await currentCustomer()
  if (!customer) redirect(`/${locale}/account/login`)

  const orders = await myOrders()
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim()

  return (
    <Container className="py-10 sm:py-14">
      <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{t(locale, "account.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {name ? `${name} — ` : ""}
            {customer.email}
          </p>
        </div>
        <SignOutButton locale={locale} />
      </div>

      <section aria-labelledby="orders-heading">
        <h2 id="orders-heading" className="mb-4 text-lg font-bold">
          {t(locale, "account.myOrders")}
        </h2>

        {orders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <Package className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t(locale, "account.noOrders")}</p>
            <Link
              href={`/${locale}`}
              className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t(locale, "order.keepShopping")}
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {orders.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/${locale}/orders/${o.id}/confirmation`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4 transition-colors hover:border-primary"
                >
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">
                      {t(locale, "order.number")} #{digits(locale, String(o.display_id))}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
                        dateStyle: "medium",
                      }).format(new Date(o.created_at))}
                    </span>
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
                      {t(locale, STATUS_KEY[o.status] ?? "order.statusPending")}
                    </span>
                    <span className="text-sm font-semibold">
                      <Price locale={locale} halalas={o.total} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  )
}
