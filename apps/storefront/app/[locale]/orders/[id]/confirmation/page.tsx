import { t, type Locale } from "@/lib/i18n"
import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import { Container } from "@/components/container"
import { Price } from "@/components/price"
import { buttonVariants } from "@/components/ui/button"
import { ReviewForm } from "@/components/review/review-form"
import { isSignedIn } from "@/lib/auth-actions"
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

  // التقييمُ لمن دخل وحدَه: القيدُ يشترط أن يكون السطرُ **لهذا
  // العميل**، والضيفُ لا هويّةَ له تُطابَق. فيُخفى النموذجُ بدل أن
  // يُعرض ثم يُردّ ٤٠٣ بلا سببٍ مفهوم.
  const signedIn = await isSignedIn()
  const lines = order?.items ?? []

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

      {/* 🔴 **وموضعُ كتابة التقييم هنا لا في صفحة المنتج** (بند ٢٣):
          القيدُ يشترط `order_line_item_id`، وهو ما تعرفه صفحةُ الطلب
          وحدَها. وزرٌّ على صفحة المنتج يقود إلى نموذجٍ لا يملك ما
          يُرسله — فالكتابةُ تبدأ من الشراء لأن الشرطَ كذلك. */}
      {signedIn && lines.length ? (
        <section
          aria-labelledby="review-heading"
          className="mt-10 w-full max-w-md space-y-4 text-start"
        >
          <h2 id="review-heading" className="text-sm font-bold">
            {t(locale, "review.title")}
          </h2>
          {lines.map((line) =>
            line.product_id ? (
              <div key={line.id} className="rounded-xl border border-border p-4">
                <p className="mb-2 text-sm font-medium">{line.title}</p>
                <ReviewForm
                  locale={locale}
                  productId={line.product_id}
                  lineItemId={line.id}
                />
              </div>
            ) : null,
          )}
        </section>
      ) : null}

      <Link href={`/${locale}`} className={buttonVariants({ className: "mt-8 h-11 px-8 text-sm font-semibold" })}>
        {t(locale, "order.continue")}
      </Link>
    </Container>
  )
}
