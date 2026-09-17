import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * منطقُ التخفيض الخاطف — **حالةٌ خالصةٌ للعرض، ومطالبةٌ تحرسها القاعدة**.
 *
 * ── وقسمةُ العمل بينهما مقصودة ──────────────────────────────────
 *
 * `flashState()` خالصةٌ بلا قاعدة: تقول للواجهة «لم يبدأ» أو «باقٍ كذا»
 * أو «انتهى» — **وهي للعرض لا للحكم**. والحكمُ عند الإتمام من ساعة
 * القاعدة وحدَها، لأن ساعةَ الزائر تُضبط باليد وصفحةً فُتحت قبل ساعةٍ
 * تبقى مفتوحة.
 *
 * `claimFlash()` تكتب صفّاً ويحكم المُطلِق. **ولا تفحص شيئاً قبله**:
 * فحصٌ في التطبيق قبل الكتابة يقرأ ثم يكتب، وبينهما تمرّ تسعٌ وتسعون
 * محاولة. وهذا بعينه ما سمح بـ٩٤ بيعاً من عشرة قبل حارس المخزون.
 */

export type FlashSaleRow = {
  id: string;
  promotion_id: string;
  promotion_code: string;
  starts_at: Date | string;
  ends_at: Date | string;
  quantity_limit: number | null;
  per_customer_limit: number | null;
  is_active: boolean;
};

export type FlashState =
  | { phase: "inactive" }
  | { phase: "upcoming"; starts_in_ms: number }
  | { phase: "live"; ends_in_ms: number }
  | { phase: "ended" };

/**
 * حالةُ العرض للعرض في الواجهة — **لا للحكم**.
 *
 * والفرقُ ليس تحفّظاً: العدّادُ التنازليُّ يُرسم من هنا، والقبولُ
 * أو الرفضُ يقع في القاعدة عند الإتمام. ولو حكمت هذه لَقبِلت طلباً
 * بعد انتهاء العرض بساعةٍ من متصفّحٍ لم يُحدَّث.
 */
export function flashState(sale: FlashSaleRow, now: Date = new Date()): FlashState {
  if (!sale.is_active) return { phase: "inactive" };

  const t = now.getTime();
  const from = new Date(sale.starts_at).getTime();
  const to = new Date(sale.ends_at).getTime();

  if (t < from) return { phase: "upcoming", starts_in_ms: from - t };
  // النهايةُ حصريّة: اللحظةُ الأخيرةُ خارج العرض — وهو نفسُ ما يفحصه
  // المُطلِق (`now() >= ends_at`)، فلا يقول أحدُهما غيرَ الآخر.
  if (t >= to) return { phase: "ended" };
  return { phase: "live", ends_in_ms: to - t };
}

export type FlashRejection = {
  code:
    | "FLASH_NOT_FOUND"
    | "FLASH_INACTIVE"
    | "FLASH_NOT_STARTED"
    | "FLASH_ENDED"
    | "FLASH_SOLD_OUT"
    | "FLASH_PER_CUSTOMER"
    | "FLASH_CLAIM_FAILED";
  message_ar: string;
};

const MESSAGES: Record<FlashRejection["code"], string> = {
  FLASH_NOT_FOUND: "لم يعُد هذا العرضُ موجوداً.",
  FLASH_INACTIVE: "أُوقف هذا العرض.",
  FLASH_NOT_STARTED: "لم يبدأ هذا العرضُ بعد.",
  FLASH_ENDED: "انتهى وقتُ هذا العرض.",
  FLASH_SOLD_OUT: "نفدت كمّيةُ العرض الخاطف.",
  FLASH_PER_CUSTOMER: "بلغتَ حدَّك من هذا العرض.",
  FLASH_CLAIM_FAILED: "تعذّر تثبيتُ العرض الخاطف. أعِد المحاولة.",
};

/**
 * يقرأ رمزَ الرفض من رسالة المُطلِق.
 *
 * ⚠️ **والرمزُ يُطابق كلمةً كاملة**: `includes` كانت ستجعل
 * `FLASH_NOT_STARTED` تُطابق `FLASH_NOT_FOUND`… لا — بل تجعل رمزاً
 * أقصرَ يُطابق داخل أطول. وقد كلّف هذا الصنفُ من الخطأ هذا المستودعَ
 * مرّتين في البحث العربيّ. فيُقرأ من نمطٍ مثبَّتٍ بحدود الكلمة.
 */
function codeOf(message: string): FlashRejection["code"] {
  const m = /zadim:\s*(FLASH_[A-Z_]+)\b/.exec(message);
  const found = m?.[1] as FlashRejection["code"] | undefined;
  return found && found in MESSAGES ? found : "FLASH_CLAIM_FAILED";
}

export type ClaimResult = { ok: true; claim_id: string } | { ok: false } & FlashRejection;

/**
 * يطالب بقطعةٍ من العرض — والقاعدةُ تحكم.
 *
 * ويُستدعى **قبل إنشاء الطلب**: الرفضُ قبل أخذ المال (`CLAUDE.md`).
 * ولو تُرك إلى ما بعده لبِيع عميلٌ بسعر عرضٍ نفد.
 */
export async function claimFlash(
  scope: any,
  input: {
    flash_sale_id: string;
    customer_key: string;
    cart_id: string;
    quantity: number;
  }
): Promise<ClaimResult> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const id = `flashclm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  try {
    await pg.raw(
      `insert into "zadim_flash_sale_claim"
         ("id", "flash_sale_id", "customer_key", "cart_id", "quantity")
       values (?, ?, ?, ?, ?)`,
      [id, input.flash_sale_id, input.customer_key, input.cart_id, input.quantity]
    );
    return { ok: true, claim_id: id };
  } catch (err) {
    const raw = String((err as Error)?.message ?? err);
    // الفهرسُ الفريدُ على (العرض، السلّة) يمنع مطالبةً ثانيةً لنفس
    // السلّة — وهي إعادةُ إرسالِ إتمامٍ لا عميلٌ جديد. فتُقرأ نجاحاً
    // لا رفضاً: الطلبُ واحدٌ والقطعةُ محجوزةٌ له أصلاً.
    if (/IDX_zadim_flash_sale_claim_cart|duplicate key/i.test(raw)) {
      return { ok: true, claim_id: `(موجودةٌ مسبقاً) ${input.cart_id}` };
    }
    const code = codeOf(raw);
    return { ok: false, code, message_ar: MESSAGES[code] };
  }
}

/**
 * يردّ قطعةً إلى العرض — **صفٌّ مقابلٌ لا حذف**.
 *
 * ويُنادى حين يسقط ما بعد المطالبة: القطعةُ حُجزت ولم يقع طلب، وحبسُها
 * يعني عرضاً ينفد وهو لم يُبَع.
 */
export async function releaseFlash(
  scope: any,
  input: { flash_sale_id: string; customer_key: string; cart_id: string; quantity: number; reason: string }
): Promise<void> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const logger = scope.resolve(ContainerRegistrationKeys.LOGGER);
  const id = `flashrel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await pg.raw(
      `insert into "zadim_flash_sale_claim"
         ("id", "flash_sale_id", "customer_key", "cart_id", "order_id", "quantity", "reason")
       values (?, ?, ?, ?, null, ?, ?)`,
      [id, input.flash_sale_id, input.customer_key, input.cart_id, -Math.abs(input.quantity), input.reason]
    );
  } catch (err) {
    // ولا يُسقط شيئاً: الردُّ تصحيحٌ لا شرطُ عمل. ويُسجَّل كي يُرى في
    // الفحص — قطعةٌ محبوسةٌ تظهر فرقاً بين المطالبات والطلبات.
    logger.warn(
      `[zadim] ⚠️ تعذّر ردُّ قطعةِ العرض الخاطف (${input.flash_sale_id}/${input.cart_id}): ` +
        String((err as Error)?.message ?? err)
    );
  }
}
