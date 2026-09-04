import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Container } from "@/components/container"
import { AuthForm } from "@/components/account/auth-form"
import { isSignedIn } from "@/lib/auth-actions"
import { t, type Locale } from "@/lib/i18n"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>
}): Promise<Metadata> {
  const { locale } = await params
  return { title: `${t(locale, "account.createAccount")} — ${t(locale, "site.name")}` }
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  if (await isSignedIn()) redirect(`/${locale}/account`)

  return (
    <Container className="py-10 sm:py-16">
      <div className="mx-auto max-w-md">
        <h1 className="mb-2 text-2xl font-bold sm:text-3xl">
          {t(locale, "account.createAccount")}
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">{t(locale, "account.registerLede")}</p>
        <AuthForm locale={locale} mode="register" />
      </div>
    </Container>
  )
}
