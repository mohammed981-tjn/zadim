import { HeroBlock } from "@/components/home/hero-block"
import { ProductGridBlock } from "@/components/home/product-grid-block"
import { BannerBlock } from "@/components/home/banner-block"
import { CategoriesBlock } from "@/components/home/categories-block"
import { RichTextBlock } from "@/components/home/rich-text-block"
import type {
  HomeBlock,
  HeroPayload,
  ProductGridPayload,
  BannerPayload,
  CategoriesPayload,
  RichTextPayload,
} from "@/lib/medusa"

/**
 * يرسم كتلةً واحدةً حسب نوعها. والنوعُ الذي لا تعرفه الواجهةُ لا يرسم
 * شيئاً ولا يُسقِط الصفحة — فالرئيسيةُ بياناتٌ لا كود.
 *
 * ── و`data-block-type` ليست زينةً ولا أداةَ اختبار ──────────────────
 *
 * هي الوجهُ المرئيُّ لبوّابة «الترتيب يتغيّر من اللوحة»: الخلفيّةُ تُعيد
 * ترتيباً، **والواجهةُ يجب أن تعرضه كما جاء**. ويقرؤها
 * `scripts/verify-ui.mjs` فيقابل ترتيبَ ما رُسم بترتيب `/store/home`.
 * وواجهةٌ ترتّب بنفسها تترك بوّابةَ الخلفية خضراءَ **والشاشةَ كاذبة**.
 *
 * ── ولماذا الغلافُ يخرج حتى للنوع المجهول ─────────────────────────
 *
 * لأن الفحصَ يقابل **تسلسلاً بتسلسل**. فلو ابتلعت الواجهةُ كتلةً مجهولةً
 * بلا أثر لاختلف الطولان، وسقطت البوّابةُ شاكيةً من ترتيبٍ سليم. فيخرج
 * غلافٌ فارغٌ يحمل النوع: لا بكسل على الشاشة، وموضعٌ محفوظٌ في التسلسل.
 * وكذلك كتلةٌ ناقصةُ الحمولة (`hero` بلا عنوان) — يبتلعها راسمُها ويبقى
 * غلافُها.
 */
function inner(block: HomeBlock) {
  switch (block.type) {
    case "hero":
      return <HeroBlock payload={block.payload as HeroPayload} />
    case "product_grid":
      return <ProductGridBlock payload={block.payload as ProductGridPayload} />
    case "banner":
      return <BannerBlock payload={block.payload as BannerPayload} />
    case "categories":
      return <CategoriesBlock payload={block.payload as CategoriesPayload} />
    case "rich_text":
      return <RichTextBlock payload={block.payload as RichTextPayload} />
    default:
      return null
  }
}

export function BlockRenderer({ block }: { block: HomeBlock }) {
  return <div data-block-type={block.type}>{inner(block)}</div>
}
