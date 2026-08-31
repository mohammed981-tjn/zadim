import type { Metadata } from "next"
import Link from "next/link"
import { Container } from "@/components/container"
import { Gallery } from "@/components/product/gallery"
import { BuyBox } from "@/components/product/buy-box"
import { EmptyState, ErrorState } from "@/components/states"
import { getProductByHandle, type ProductImage } from "@/lib/medusa"

type Params = { handle: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await params
  try {
    const product = await getProductByHandle(handle)
    if (product) {
      return {
        title: `${product.title} — زادم`,
        description: product.subtitle ?? product.description ?? undefined,
      }
    }
  } catch {
    /* fall through to default */
  }
  return { title: "منتج — زادم" }
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { handle } = await params

  let product
  try {
    product = await getProductByHandle(handle)
  } catch {
    return (
      <Container className="py-16">
        <ErrorState title="تعذّر تحميل المنتج" />
      </Container>
    )
  }

  if (!product) {
    return (
      <Container className="py-16">
        <EmptyState
          title="المنتج غير موجود"
          description="ربما تمت إزالة هذا المنتج. تصفّح بقية المتجر من الصفحة الرئيسية."
          actionHref="/"
          actionLabel="العودة للرئيسية"
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

  return (
    <Container className="py-8 sm:py-12">
      <nav aria-label="مسار التنقّل" className="mb-6 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          الرئيسية
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span className="text-foreground">{product.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <Gallery images={images} title={product.title} />
        <BuyBox product={product} />
      </div>
    </Container>
  )
}
