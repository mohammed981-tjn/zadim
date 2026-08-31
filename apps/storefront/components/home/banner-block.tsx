import Image from "next/image"
import Link from "next/link"
import { Container } from "@/components/container"
import type { BannerPayload } from "@/lib/medusa"

export function BannerBlock({ payload }: { payload: BannerPayload }) {
  if (!payload?.title) return null

  const inner = (
    <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-muted sm:aspect-[21/7]">
      {payload.image_url ? (
        <Image
          src={payload.image_url || "/placeholder.svg"}
          alt={payload.title}
          fill
          sizes="(max-width: 1280px) 100vw, 1280px"
          className="object-cover"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-foreground/60 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
        <h2 className="text-xl font-bold text-balance text-white sm:text-3xl">{payload.title}</h2>
      </div>
    </div>
  )

  return (
    <section className="py-6 sm:py-8">
      <Container>
        {payload.href ? (
          <Link href={payload.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl">
            {inner}
          </Link>
        ) : (
          inner
        )}
      </Container>
    </section>
  )
}
