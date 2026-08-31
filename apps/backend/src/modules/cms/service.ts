import { MedusaService } from "@medusajs/framework/utils";
import { PageBlock } from "./models";

/**
 * خدمةُ المحتوى.
 *
 * ── الترتيبُ حاسمٌ حتى عند التساوي ──────────────────────────────
 *
 * كتلتان بنفس `position` ترتيبُهما عند القاعدة غيرُ مضمون: تظهران
 * بترتيبٍ اليومَ وبآخرَ غداً بلا أن يمسّهما أحد. والمديرُ يرى صفحتَه
 * تتبدّل بلا سبب. **فالمعرّفُ يحسم التعادل**، والترتيبُ يُعاد إنتاجُه
 * دائماً.
 */
class CmsModuleService extends MedusaService({ PageBlock }) {
  /** كتلُ الصفحة الظاهرة، مرتّبةً كما يراها العميل. */
  async blocksFor(page = "home") {
    const rows = await this.listPageBlocks(
      { page, is_active: true },
      { order: { position: "ASC", id: "ASC" } }
    );
    return rows;
  }

  /**
   * يُعيد الترتيبَ بقائمةِ معرّفات — **الأولُ أعلى**.
   *
   * والترقيمُ بعشراتٍ لا بآحاد: إدخالُ كتلةٍ بين اثنتين لاحقاً لا يحتاج
   * إعادةَ ترقيم الصفحة كلِّها.
   */
  async reorder(page: string, orderedIds: string[]) {
    const existing = await this.listPageBlocks({ page });
    const known = new Set(existing.map((b: any) => b.id));
    const unknown = orderedIds.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new Error(`[zadim] كتلٌ ليست في هذه الصفحة: ${unknown.join(", ")}`);
    }

    let position = 10;
    for (const id of orderedIds) {
      await this.updatePageBlocks({ id, position });
      position += 10;
    }

    // ما لم يُذكر يُدفع إلى الآخر بترتيبه الحاليّ — ولا يُحذف ولا يُخفى.
    const rest = existing
      .filter((b: any) => !orderedIds.includes(b.id))
      .sort((a: any, b: any) => Number(a.position) - Number(b.position));
    for (const b of rest as any[]) {
      await this.updatePageBlocks({ id: b.id, position });
      position += 10;
    }

    return this.blocksFor(page);
  }
}

export default CmsModuleService;
