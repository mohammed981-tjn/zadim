import { MedusaService } from "@medusajs/framework/utils";
import { WishlistItem } from "./models";

/**
 * خدمةُ المفضّلة (بند ٢٢) — وطرفاها اثنان لا واحد:
 *
 * ١. ما يفتحه العميلُ ويضيف إليه ويحذف منه.
 * ٢. **ومن يُنبَّه حين يرخص سعرٌ** — وهذا هو البند، والأوّلُ وسيلتُه.
 */
class WishlistModuleService extends MedusaService({ WishlistItem }) {
  async listFor(customerId: string) {
    if (!customerId) return [];
    return this.listWishlistItems(
      { customer_id: customerId },
      { order: { created_at: "DESC" } }
    );
  }

  /**
   * الإضافةُ **مُتماثلةٌ عند الإعادة**: ضغطتان تُعطيان صفّاً واحداً.
   *
   * والقيدُ الفريدُ هو الحَكَم لا فحصٌ يسبق الكتابة (ADR-014): ضغطتان
   * متزامنتان تمرّان من الفحص كلتاهما ثم تكتبان صفّين. فيُحاوَل الإدراجُ
   * ويُمسَك الاصطدام.
   */
  async add(input: { customer_id: string; product_id: string; variant_id?: string | null }) {
    try {
      // كائنٌ واحدٌ لا مصفوفة: `createWishlistItems` مُحمَّلٌ زائداً،
      // ويُعيد كائناً للواحد ومصفوفةً للمصفوفة. وتفكيكُ الكائن يسقط
      // عند الترجمة لا وقتَ التشغيل — وهو ما أمسكه `tsc`.
      const created = await this.createWishlistItems({
        customer_id: input.customer_id,
        product_id: input.product_id,
        variant_id: input.variant_id ?? null,
      } as any);
      return { item: created, created: true };
    } catch (err) {
      // الصفُّ قائمٌ — وهي حالُ نجاحٍ لا خطأ: المطلوبُ أن يكون فيها،
      // وهو فيها. ولا يُردّ خطأٌ لعميلٍ ضغط مرّتين.
      const [existing] = await this.listWishlistItems(
        { customer_id: input.customer_id, product_id: input.product_id },
        { take: 1 }
      );
      if (existing) return { item: existing, created: false };
      throw err;
    }
  }

  /**
   * 🔴 **من ينتظر رخصَ هذا المنتج** — الطرفُ الذي كان ناقصاً.
   *
   * و`variant_id` في الصفّ يضيّق: من اختار متغيّراً بعينه لا يُنبَّه
   * لرخص غيره. ومن لم يختر (`null`) يُنبَّه لأيّ متغيّر.
   */
  async watchersOf(productId: string, variantId?: string | null) {
    if (!productId) return [];
    const rows = (await this.listWishlistItems({ product_id: productId })) as any[];
    if (!variantId) return rows;
    return rows.filter((r) => !r.variant_id || r.variant_id === variantId);
  }

  async remove(customerId: string, productId: string): Promise<boolean> {
    const [row] = await this.listWishlistItems(
      { customer_id: customerId, product_id: productId },
      { take: 1 }
    );
    if (!row) return false;
    await this.deleteWishlistItems((row as any).id);
    return true;
  }
}

export default WishlistModuleService;
