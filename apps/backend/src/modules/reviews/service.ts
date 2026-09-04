import { MedusaService } from "@medusajs/framework/utils";
import { Review } from "./models";

/**
 * خدمةُ التقييمات (بند ٢٣).
 *
 * ⚠️ **ولا تفحص الشراءَ هنا.** الفحصُ في المُطلِق
 * (`zadim_guard_review_purchase_trg`) — وهو موضعُه الصحيح: تُنشأ
 * التقييماتُ من مسارِ المتجر ومن استيرادٍ ومن تصحيحٍ إداريّ، وكلُّ طريقٍ
 * يفحص بنفسه طريقٌ يُنسى فيه الفحصُ يوماً. **وفحصٌ هنا يُضاعف المنطقَ
 * ولا يزيد أماناً**: من ينادي القاعدةَ مباشرةً لا يمرّ بهذه الخدمة.
 */
class ReviewsModuleService extends MedusaService({ Review }) {
  /** تقييماتُ منتجٍ **المنشورةُ وحدَها** — وهي ما يراه الزائر. */
  async publishedFor(productId: string) {
    if (!productId) return [];
    return this.listReviews(
      { product_id: productId, status: "published" },
      { order: { created_at: "DESC" } }
    );
  }

  /**
   * متوسّطُ التقييم وعددُه — **يُحسب عند القراءة لا يُخزَّن**.
   *
   * وعمودٌ محدَّثٌ لمتوسّطٍ يفترق عن مصدره عند أوّل حذفٍ أو رفضٍ يُنسى
   * تحديثُه بعده، ثم يعرض المنتجُ ٤٫٨ ولا تقييمَ له. وهو نفسُ منطق
   * `dashboard/metrics.ts`.
   */
  async summaryFor(productId: string): Promise<{ average: number | null; count: number }> {
    const rows = (await this.publishedFor(productId)) as any[];
    if (!rows.length) return { average: null, count: 0 };
    const total = rows.reduce((sum, r) => sum + Number(r.rating), 0);
    // بخانةٍ عشريةٍ واحدة: «٤٫٣» يفهمها الجميع، و«٤٫٣٣٣٣» تُوهم دقّةً
    // لا معنى لها على مقياسٍ من خمس درجات.
    return { average: Math.round((total / rows.length) * 10) / 10, count: rows.length };
  }

  async myReviews(customerId: string) {
    if (!customerId) return [];
    return this.listReviews({ customer_id: customerId }, { order: { created_at: "DESC" } });
  }
}

export default ReviewsModuleService;
