import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AuthScreen } from "@/components/account/auth-screen"
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

  return <AuthScreen locale={locale} mode="register" />
}
