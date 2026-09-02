import { t, type Locale } from "@/lib/i18n"
import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import { Container } from "@/components/container"
import { Price } from "@/components/price"
import { buttonVariants } from "@/components/ui/button"
import { getOrder } from "@/lib/medusa"
import { digits } from "@/lib/money"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  return { title: `${t(locale, "order.confirmed")} — ${t(locale, "site.name")}` }
}

export const dynamic = "force-dynamic"

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ id: string; locale: Locale }>
}) {
  const { id, locale } = await params

  let order = null
  try {
    order = await getOrder(id)
  } catch {
    order = null
  }

  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <CheckCircle2 className="size-16 text-success" aria-hidden="true" />
      <h1 className="mt-6 text-2xl font-bold md:text-3xl text-balance">{t(locale, "order.confirmedLong")}</h1>

      {order ? (
        <>
          <p className="mt-3 text-muted-foreground">
            {t(locale, "order.numberLabel")}{" "}
            <span className="tabular font-semibold text-foreground">
              {digits(locale, `#${order.display_id}`)}
            </span>
          </p>
          <p className="mt-1 text-muted-foreground">
            {t(locale, "order.paidLabel")} <Price locale={locale} halalas={order.total} className="font-semibold text-foreground" />
          </p>
        </>
      ) : (
        <p className="mt-3 text-muted-foreground text-pretty">
          {t(locale, "order.recorded")}
        </p>
      )}

      <p className="mt-6 max-w-md text-sm text-muted-foreground text-pretty">
        {t(locale, "order.thanks")}
      </p>

      <Link href={`/${locale}`} className={buttonVariants({ className: "mt-8 h-11 px-8 text-sm font-semibold" })}>
        {t(locale, "order.continue")}
      </Link>
    </Container>
  )
}
