import Image from "next/image"
import Link from "next/link"
import { Container } from "@/components/container"
import { getCategoriesByIds, type CategoriesPayload } from "@/lib/medusa"

export async function CategoriesBlock({ payload }: { payload: CategoriesPayload }) {
  if (!payload?.category_ids?.length) return null

  let categories
  try {
    categories = await getCategoriesByIds(payload.category_ids)
  } catch {
    return null
  }

  if (!categories.length) return null

  return (
    <section className="py-10 sm:py-14">
      <Container className="space-y-6">
        {payload.title ? <h2 className="text-xl font-bold sm:text-2xl">{payload.title}</h2> : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/c/${c.handle}`}
              className="group relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-2xl border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {c.thumbnail ? (
                <Image
                  src={c.thumbnail || "/placeholder.svg"}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 50vw, 25vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-foreground/70 to-transparent" />
              <span className="relative p-4 text-base font-semibold text-white text-balance sm:text-lg">
                {c.name}
              </span>
            </Link>
          ))}
        </div>
      </Container>
    </section>
  )
}
