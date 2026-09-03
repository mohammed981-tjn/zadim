import { MedusaService } from "@medusajs/framework/utils";
import { VariantCost } from "./models";

/**
 * خدمةُ المالية — **تكلفةُ الوحدة وحدَها اليوم** (بند ٣٤/٣٥).
 *
 * ولا تحسب ربحاً ولا تُصدر تقريراً: التقاريرُ تُبنى فوق هذا لاحقاً،
 * وما لا يُبنى اليوم يبقى ممكناً غداً. **والذي لا يبقى ممكناً غداً هو
 * تسجيلُ التكلفة نفسِها** — ولذلك بُنيت الآن.
 */
class FinanceModuleService extends MedusaService({ VariantCost }) {
  /** التكلفةُ النافذة لمتغيّر — أو `null` إن لم تُسجَّل قطّ. */
  async currentCost(variantId: string): Promise<number | null> {
    if (!variantId) return null;
    const [row] = await this.listVariantCosts(
      { variant_id: variantId, effective_to: null },
      { take: 1 }
    );
    return row ? Number((row as any).unit_cost) : null;
  }

  /**
   * تسجيلُ تكلفةٍ جديدة — **صفٌّ جديدٌ لا تحديثُ القديم**.
   *
   * وإغلاقُ الصفّ السابق يقع في القاعدة (مُطلِق
   * `zadim_close_previous_cost_trg`) لا هنا: كاتبٌ آخر — استيرادٌ أو
   * سكربتٌ أو لوحة — لا يمرّ بهذه الدالّة، ويجب أن يُغلق سابقُه أيضاً.
   */
  async recordCost(input: {
    variant_id: string;
    unit_cost: number;
    source?: string;
    note?: string | null;
  }) {
    if (!Number.isInteger(input.unit_cost) || input.unit_cost < 0) {
      // بالهللات صحيحةً (ADR-008). و«١٩.٩٩» هنا تعني تسعَ عشرةَ هللةً
      // لا تسعةَ عشرَ ريالاً — والفرقُ مئةُ ضعف، فيُرفض لا يُقرَّب.
      throw new Error("zadim: unit_cost بالهللات صحيحةً وغيرِ سالبة");
    }
    return this.createVariantCosts({
      variant_id: input.variant_id,
      unit_cost: input.unit_cost,
      source: input.source || "manual",
      effective_from: new Date(),
      note: input.note ?? null,
    } as any);
  }
}

export default FinanceModuleService;
