import { type Locale } from "@/lib/i18n"
import Image from "next/image"
import Link from "next/link"
import { Container } from "@/components/container"
import { buttonVariants } from "@/components/ui/button"
import type { HeroPayload } from "@/lib/medusa"

export function HeroBlock({ payload, locale }: { payload: HeroPayload; locale: Locale }) {
  if (!payload?.title) return null

  return (
    <section className="relative overflow-hidden bg-primary text-primary-foreground">
      {payload.image_url ? (
        <>
          <Image
            src={payload.image_url || "/placeholder.svg"}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-primary/95 via-primary/70 to-primary/30" />
        </>
      ) : null}

      <Container className="relative flex min-h-[60vh] flex-col justify-end gap-4 py-12 sm:min-h-[70vh] sm:py-20">
        <div className="max-w-2xl space-y-4">
          <h1 className="text-3xl font-bold leading-tight text-balance sm:text-5xl">{payload.title}</h1>
          {payload.subtitle ? (
            <p className="max-w-xl text-base leading-relaxed text-primary-foreground/85 text-pretty sm:text-lg">
              {payload.subtitle}
            </p>
          ) : null}
          {payload.cta_label && payload.cta_href ? (
            <Link
              href={`/${locale}${payload.cta_href}`}
              className={buttonVariants({
                variant: "secondary",
                className: "mt-2 h-12 px-8 text-base font-semibold",
              })}
            >
              {payload.cta_label}
            </Link>
          ) : null}
        </div>
      </Container>
    </section>
  )
}
