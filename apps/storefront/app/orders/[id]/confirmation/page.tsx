import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import { Container } from "@/components/container"
import { Price } from "@/components/price"
import { buttonVariants } from "@/components/ui/button"
import { getOrder } from "@/lib/medusa"
import { toArabicDigits } from "@/lib/money"

export const metadata: Metadata = {
  title: "تم استلام طلبك — زادم",
}

export const dynamic = "force-dynamic"

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let order = null
  try {
    order = await getOrder(id)
  } catch {
    order = null
  }

  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <CheckCircle2 className="size-16 text-success" aria-hidden="true" />
      <h1 className="mt-6 text-2xl font-bold md:text-3xl text-balance">تم استلام طلبك بنجاح</h1>

      {order ? (
        <>
          <p className="mt-3 text-muted-foreground">
            رقم الطلب:{" "}
            <span className="tabular font-semibold text-foreground">
              {toArabicDigits(`#${order.display_id}`)}
            </span>
          </p>
          <p className="mt-1 text-muted-foreground">
            الإجمالي المدفوع: <Price halalas={order.total} className="font-semibold text-foreground" />
          </p>
        </>
      ) : (
        <p className="mt-3 text-muted-foreground text-pretty">
          تم تسجيل طلبك. سنرسل إليك تفاصيل التأكيد قريبًا.
        </p>
      )}

      <p className="mt-6 max-w-md text-sm text-muted-foreground text-pretty">
        شكرًا لتسوّقك من زادم. سيصلك إشعار عند شحن طلبك.
      </p>

      <Link href="/" className={buttonVariants({ className: "mt-8 h-11 px-8 text-sm font-semibold" })}>
        متابعة التسوّق
      </Link>
    </Container>
  )
}
