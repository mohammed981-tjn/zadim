import { Container } from "@/components/container"
import type { RichTextPayload } from "@/lib/medusa"

export function RichTextBlock({ payload }: { payload: RichTextPayload }) {
  if (!payload?.body) return null

  // Render the body as plain paragraphs split on blank lines (no raw HTML).
  const paragraphs = payload.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  return (
    <section className="py-10 sm:py-14">
      <Container className="max-w-3xl space-y-4">
        {payload.title ? <h2 className="text-xl font-bold sm:text-2xl text-balance">{payload.title}</h2> : null}
        <div className="space-y-3 text-base leading-relaxed text-muted-foreground">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-pretty">
              {p}
            </p>
          ))}
        </div>
      </Container>
    </section>
  )
}
