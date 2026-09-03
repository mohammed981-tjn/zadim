import { t, type Locale } from "@/lib/i18n"
import type { Metadata } from "next"
import Link from "next/link"
import { Container } from "@/components/container"
import { Gallery } from "@/components/product/gallery"
import { BuyBox } from "@/components/product/buy-box"
import { EmptyState, ErrorState } from "@/components/states"
import { FavoriteButton } from "@/components/wishlist/favorite-button"
import { isSignedIn, myFavorites } from "@/lib/auth-actions"
import { getProductByHandle, type ProductImage } from "@/lib/medusa"

type Params = { handle: string; locale: Locale }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle, locale } = await params
  try {
    const product = await getProductByHandle(handle, locale)
    if (product) {
      return {
        title: `${product.title} — ${t(locale, "site.name")}`,
        description: product.subtitle ?? product.description ?? undefined,
      }
    }
  } catch {
    /* fall through to default */
  }
  return { title: `${t(locale, "product.one")} — ${t(locale, "site.name")}` }
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { handle, locale } = await params

  let product
  try {
    product = await getProductByHandle(handle, locale)
  } catch {
    return (
      <Container className="py-16">
        <ErrorState title={t(locale, "product.loadFailed")} />
      </Container>
    )
  }

  if (!product) {
    return (
      <Container className="py-16">
        <EmptyState
          title={t(locale, "product.notFound")}
          description={t(locale, "product.removedHint")}
          actionHref={`/${locale}`}
          actionLabel={t(locale, "home.backHome")}
        />
      </Container>
    )
  }

  const images: ProductImage[] =
    product.images?.length
      ? product.images
      : product.thumbnail
        ? [{ id: "thumb", url: product.thumbnail }]
        : []

  // حالةُ المفضّلة تُقرأ من الخادم لا من المتصفّح: قلبٌ يبدأ فارغاً
  // ثم يمتلئ بعد لحظةٍ يجعل الزائرَ يضغطه فيُلغي ما كان محفوظاً.
  const [signedIn, favorites] = await Promise.all([isSignedIn(), myFavorites()])
  const saved = favorites.some((f) => f.product_id === product.id)

  return (
    <Container className="py-8 sm:py-12">
      <nav aria-label={t(locale, "product.breadcrumb")} className="mb-6 text-sm text-muted-foreground">
        <Link href={`/${locale}`} className="hover:text-foreground">
          {t(locale, "nav.home")}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-foreground">{product.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="relative">
          <Gallery locale={locale} images={images} title={product.title} />
          <FavoriteButton
            productId={product.id}
            locale={locale}
            initiallySaved={saved}
            signedIn={signedIn}
            className="absolute top-3 end-3 z-10"
          />
        </div>
        <BuyBox locale={locale} product={product} />
      </div>
    </Container>
  )
}
