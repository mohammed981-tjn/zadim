import { Container } from "@/components/container"
import { BlockRenderer } from "@/components/home/block-renderer"
import { EmptyState, ErrorState } from "@/components/states"
import { getHome } from "@/lib/medusa"
import { t, type Locale } from "@/lib/i18n"

export const revalidate = 60

export default async function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params

  let blocks
  try {
    const home = await getHome(locale)
    blocks = home.blocks
  } catch {
    return (
      <Container className="py-16">
        <ErrorState
          title={t(locale, "home.loadFailed")}
          description={t(locale, "home.loadFailedHint")}
        />
      </Container>
    )
  }

  if (!blocks.length) {
    return (
      <Container className="py-16">
        <EmptyState title={t(locale, "home.emptyTitle")} description={t(locale, "home.emptyBody")} />
      </Container>
    )
  }

  return (
    <div>
      {blocks.map((block) => (
        <BlockRenderer key={block.id} block={block} locale={locale} />
      ))}
    </div>
  )
}
