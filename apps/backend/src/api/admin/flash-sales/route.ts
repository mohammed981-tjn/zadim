import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { COUPON_POLICY_MODULE } from "../../../modules/promotions";
import type PromotionsPolicyService from "../../../modules/promotions/service";
import { flashState } from "../../../modules/promotions/flash";

/**
 * `GET|POST /admin/flash-sales` — التخفيضاتُ الخاطفة.
 *
 * ⚠️ **ولا رقمَ مبرمَجاً هنا** (بند ٤٨): النافذةُ والسقفُ وحدُّ العميل
 * كلُّها من الجسم، وغيابُها يعني «بلا حدّ» لا حدّاً افتراضياً.
 */

function sanitize(sale: any, claimed: number) {
  const state = flashState(sale);
  return {
    id: sale.id,
    promotion_id: sale.promotion_id,
    promotion_code: sale.promotion_code,
    starts_at: sale.starts_at,
    ends_at: sale.ends_at,
    quantity_limit: sale.quantity_limit,
    per_customer_limit: sale.per_customer_limit,
    is_active: sale.is_active,
    /** المطالَبُ به صافياً — يُجمع من الدفتر ولا يُخزَّن. */
    claimed,
    /** والمتبقّي `null` حين لا سقفَ كمّيّ — لا صفراً يوهم بالنفاد. */
    remaining: sale.quantity_limit == null ? null : Number(sale.quantity_limit) - claimed,
    state,
  };
}

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const policies = req.scope.resolve(COUPON_POLICY_MODULE) as PromotionsPolicyService;
  const rows = (await policies.listFlashSales({})) as any[];

  const out = [];
  for (const sale of rows) out.push(sanitize(sale, await policies.flashClaimed(sale.id)));

  // الجاري أوّلاً ثم القادمُ ثم المنتهي — كما يقرؤها من يتابع حملة.
  const rank: Record<string, number> = { live: 0, upcoming: 1, inactive: 2, ended: 3 };
  out.sort((a, b) => rank[a.state.phase] - rank[b.state.phase]);

  res.json({ flash_sales: out, count: out.length });
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const policies = req.scope.resolve(COUPON_POLICY_MODULE) as PromotionsPolicyService;
  const promo: any = req.scope.resolve(Modules.PROMOTION);
  const body = (req.body ?? {}) as Record<string, any>;

  const code = String(body.promotion_code ?? "").trim();
  if (!code) {
    res.status(400).json({ code: "CODE_REQUIRED", message_ar: "رمزُ العرض مطلوب." });
    return;
  }

  // 🔴 العرضُ يجب أن يكون موجوداً في المحرّك: التخفيضُ الخاطف **نافذةٌ
  // وسقفٌ فوق خصمٍ قائم** لا خصمٌ بنفسه. وصفٌّ بلا عرضٍ يُنتج سقفاً
  // يحرس لا شيء — ولا يُكتشف حتى يسأل المديرُ لماذا لا يخصم.
  const [promotion] = (await promo.listPromotions({ code })) as any[];
  if (!promotion) {
    res.status(404).json({
      code: "PROMOTION_NOT_FOUND",
      message_ar: `لا عرضَ بالرمز «${code}». أنشئ العرضَ في لوحة Medusa أوّلاً.`,
    });
    return;
  }

  const starts = new Date(body.starts_at);
  const ends = new Date(body.ends_at);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    res.status(400).json({ code: "WINDOW_REQUIRED", message_ar: "بدايةُ النافذة ونهايتُها مطلوبتان." });
    return;
  }
  // والقاعدةُ تحرسها أيضاً (`zadim_flash_sale_window_check`) — وهذا
  // يترجم الرفضَ إلى رسالةٍ عربيةٍ لا يُغني عنه.
  if (ends <= starts) {
    res.status(400).json({ code: "WINDOW_INVALID", message_ar: "نهايةُ العرض يجب أن تكون بعد بدايته." });
    return;
  }

  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

  try {
    // ⚠️ بمصفوفةٍ عمداً: `createFlashSales` بكائنٍ واحدٍ يُعيد كائناً،
    // وبمصفوفةٍ يُعيد مصفوفة. والتفكيكُ على الأوّل يُعيد `undefined`
    // صامتاً — فيردّ المسارُ ٢٠١ بجسمٍ فارغٍ ويظنّ المديرُ أنه أنشأ.
    const created = ((await policies.createFlashSales([
      {
        promotion_id: promotion.id,
        promotion_code: code,
        starts_at: starts,
        ends_at: ends,
        quantity_limit: num(body.quantity_limit),
        per_customer_limit: num(body.per_customer_limit),
        is_active: body.is_active !== false,
      },
    ] as any)) as unknown as any[])[0];
    res.status(201).json({ flash_sale: sanitize(created, 0) });
  } catch (e) {
    const raw = String((e as Error)?.message ?? e);
    if (/IDX_zadim_flash_sale_promotion|duplicate key/i.test(raw)) {
      res.status(409).json({
        code: "FLASH_EXISTS",
        message_ar: "لهذا العرض تخفيضٌ خاطفٌ قائمٌ — عدّله بدل إنشاء ثانٍ.",
      });
      return;
    }
    if (/zadim_flash_sale_qty_check|zadim_flash_sale_per_customer_check/.test(raw)) {
      res.status(400).json({
        code: "LIMIT_INVALID",
        message_ar: "الحدُّ رقمٌ أكبرُ من صفر. والصفرُ إطفاءٌ يُقال بإيقاف العرض.",
      });
      return;
    }
    throw e;
  }
}
