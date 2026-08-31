import { Container } from "@/components/container"
import { BlockRenderer } from "@/components/home/block-renderer"
import { EmptyState, ErrorState } from "@/components/states"
import { getHome } from "@/lib/medusa"

export const revalidate = 60

export default async function HomePage() {
  let blocks
  try {
    const home = await getHome()
    blocks = home.blocks
  } catch {
    return (
      <Container className="py-16">
        <ErrorState
          title="تعذّر تحميل الصفحة الرئيسية"
          description="لم نتمكّن من الوصول إلى المتجر الآن. يرجى تحديث الصفحة بعد قليل."
        />
      </Container>
    )
  }

  if (!blocks.length) {
    return (
      <Container className="py-16">
        <EmptyState
          title="لا يوجد محتوى بعد"
          description="لم تتم إضافة أي أقسام إلى الصفحة الرئيسية حتى الآن."
        />
      </Container>
    )
  }

  return (
    <div>
      {blocks.map((block) => (
        <BlockRenderer key={block.id} block={block} />
      ))}
    </div>
  )
}
