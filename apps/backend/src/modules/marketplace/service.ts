import { MedusaService } from "@medusajs/framework/utils";
import { Vendor } from "./models";

/**
 * خدمةُ السوق — **سجلُّ البائعين وحدَه** (بند ٥٩، معطَّل).
 *
 * ولا تقسم مالاً ولا تُصدر تسويةً: تلك مرحلةُ فتح السوق. وهذه تُنشئ
 * البائعَ وتقرأه، ليكون `vendor_id` في الجداول مفتاحاً يشير إلى شيءٍ
 * لا رقماً معلَّقاً.
 */
class MarketplaceModuleService extends MedusaService({ Vendor }) {
  /** البائعُ بالمسار — أو `null`. */
  async byHandle(handle: string) {
    if (!handle) return null;
    const [row] = await this.listVendors({ handle }, { take: 1 });
    return row ?? null;
  }

  /** البائعون المعتمدون وحدَهم — ومن لم يُعتمد لا يظهر. */
  async activeVendors() {
    return this.listVendors({ is_active: true });
  }
}

export default MarketplaceModuleService;
