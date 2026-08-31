import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { WAREHOUSE_MODULE } from "../../../../modules/warehouse";
import type WarehouseModuleService from "../../../../modules/warehouse/service";

const SCAN_LIMIT = 5000;

/**
 * ما بلغ حدَّ التنبيه أو نزل دونه، الآن.
 *
 * ── لماذا يُحسب عند الطلب لا يُخزَّن ─────────────────────────────
 *
 * جدولُ تنبيهاتٍ محفوظ يحتاج من يُبطلها حين يُستلم المخزون، ومن ينشئها
 * حين ينزل، ومن ينظّفها حين تتغيّر القاعدة. وكلُّ واحدةٍ من هذه الثلاث
 * بابُ تنبيهٍ عالقٍ يقول «نفد» لبضاعةٍ امتلأ رفُّها — **وتنبيهٌ يكذب
 * مرّةً يُتجاهل دائماً**.
 *
 * والحسابُ هنا جمعُ صفوفٍ في الذاكرة: رخيصٌ إلى عشرات الآلاف. ويوم
 * يضيق يُنقل إلى استعلامٍ واحدٍ في القاعدة — لا إلى جدولٍ يُصان.
 *
 * ⚠️ **وسقفُ المسح مُعلَنٌ في الردّ** (`scanned`/`truncated`): تقريرٌ
 * يقول «لا تنبيهات» وقد مسح نصفَ المخزون كذبةٌ صامتة.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const warehouse = req.scope.resolve<WarehouseModuleService>(WAREHOUSE_MODULE);
  const inventory = req.scope.resolve(Modules.INVENTORY);
  const q = req.query as Record<string, string | undefined>;

  const rules = await warehouse.activeAlertRules();
  if (!rules.length) {
    return res.json({
      alerts: [],
      rules_count: 0,
      scanned: 0,
      truncated: false,
      message_ar: "لا قاعدةَ تنبيهٍ نشطة — لا حدَّ يُقاس عليه.",
    });
  }

  const filters: Record<string, unknown> = {};
  if (q.location_id) filters.location_id = q.location_id;

  const levels = await inventory.listInventoryLevels(filters, { take: SCAN_LIMIT + 1 });
  const truncated = levels.length > SCAN_LIMIT;
  const scanned = truncated ? levels.slice(0, SCAN_LIMIT) : levels;

  const alerts = warehouse.findBreaches(
    scanned.map((l: any) => ({
      inventory_item_id: l.inventory_item_id,
      location_id: l.location_id,
      stocked_quantity: Number(l.stocked_quantity),
      reserved_quantity: Number(l.reserved_quantity),
    })),
    rules
  );

  res.json({
    alerts,
    rules_count: rules.length,
    scanned: scanned.length,
    truncated,
  });
}
