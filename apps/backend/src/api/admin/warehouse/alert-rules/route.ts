import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { WAREHOUSE_MODULE } from "../../../../modules/warehouse";
import type WarehouseModuleService from "../../../../modules/warehouse/service";

type Body = {
  scope?: "global" | "item" | "location" | "item_location";
  inventory_item_id?: string | null;
  location_id?: string | null;
  threshold_quantity?: number;
  is_active?: boolean;
  note?: string | null;
};

const SCOPES = ["global", "item", "location", "item_location"] as const;

/**
 * حدودُ تنبيه النفاد — **بيانات لا كود** (بند ٤٨).
 *
 * ولا رقمَ افتراضيّ يُبذر في الكود: القاعدةُ العامّة يضعها المدير مرّةً
 * من هنا. ومتجرٌ بلا قاعدةٍ عامّة **لا يُنبَّه**، وهذا صحيح — تنبيهٌ
 * برقمٍ لم يخترْه أحدٌ يُتجاهل بعد أسبوع، ثم يُتجاهل يوم يَصدق.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const warehouse = req.scope.resolve<WarehouseModuleService>(WAREHOUSE_MODULE);
  const rules = await warehouse.listStockAlertRules({});
  res.json({ rules });
}

export async function POST(req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) {
  const warehouse = req.scope.resolve<WarehouseModuleService>(WAREHOUSE_MODULE);
  const body = ((req as any).validatedBody ?? req.body ?? {}) as Body;

  const scope = body.scope;
  if (!scope || !SCOPES.includes(scope)) {
    return res.status(400).json({
      error: { code: "INVALID_SCOPE", message_ar: `scope من: ${SCOPES.join(" · ")}` },
    });
  }

  const threshold = Number(body.threshold_quantity);
  if (!Number.isInteger(threshold) || threshold < 0) {
    return res.status(400).json({
      error: {
        code: "INVALID_THRESHOLD",
        message_ar: "threshold_quantity عددٌ صحيحٌ غيرُ سالب",
      },
    });
  }

  const item = body.inventory_item_id ?? null;
  const loc = body.location_id ?? null;

  // نفسُ شرطِ القاعدة، مكرّراً هنا عمداً: القاعدةُ تردّ برسالةٍ
  // إنجليزيةٍ عن قيدٍ لا يفهمها من يملأ الاستمارة.
  const shapeOk =
    (scope === "global" && !item && !loc) ||
    (scope === "item" && !!item && !loc) ||
    (scope === "location" && !item && !!loc) ||
    (scope === "item_location" && !!item && !!loc);

  if (!shapeOk) {
    return res.status(400).json({
      error: {
        code: "SCOPE_FIELDS_MISMATCH",
        message_ar:
          "النطاقُ يُلزم حقولَه: global بلا شيء · item بمادّة · location بمستودع · item_location بكليهما",
      },
    });
  }

  const [rule] = await warehouse.createStockAlertRules([
    {
      scope,
      inventory_item_id: item,
      location_id: loc,
      threshold_quantity: threshold,
      is_active: body.is_active ?? true,
      note: body.note ?? null,
    },
  ]);

  res.status(201).json({ rule });
}
