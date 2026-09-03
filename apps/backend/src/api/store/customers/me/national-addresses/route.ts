import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import {
  readNationalAddress,
  toMedusaAddress,
  validateNationalAddress,
} from "../../../../../modules/checkout/national-address";
import { identityFromToken } from "../../../../../modules/checkout/identity";

/**
 * عناوينُ العميل المحفوظة — `GET` و`POST /store/customers/me/national-addresses`.
 *
 * ── لماذا مسارٌ لنا و`‎/store/customers/me/addresses` موجودٌ عند Medusa ──
 *
 * لنفس سبب `‎/store/carts/:id/address`: مسارُ Medusa يقبل **أيَّ** عنوان.
 * لا يعرف رقمَ مبنىً ولا حيّاً ولا رقماً إضافياً، ولا يرفض رمزاً بريدياً
 * من ثلاثة أرقام.
 *
 * وعنوانٌ محفوظٌ ناقصٌ **أسوأُ من غياب الحفظ**: العميلُ يختاره من قائمة
 * فيظنّ أنه أدخله كاملاً، ثم يُرفض طلبُه عند آخر خطوة — أو يُشحن إلى
 * عنوانٍ لا يُوصَل إليه. فالمحفوظُ يُفحص بنفس صرامة المكتوب.
 *
 * 🔴 **والقائمةُ تُبنى من رمز الجلسة لا من مُعامل.** لا `customer_id`
 * في المسار ولا في الاستعلام: من يمرّره يقرأ عناوينَ غيره وهواتفَهم.
 *
 * ⚠️ **ويُخزَّن مهيكلاً ومركَّباً معاً**: `metadata.national_address` هو
 * المصدر، و`address_1`/`address_2` مشتقّان منه لملصق الشحن. ولا يُشتقّ
 * المهيكلُ من النصّ أبداً — الاتجاهُ واحد (`national-address.ts`).
 */

/** سقفٌ للعناوين المحفوظة — لا رقمَ في الكود بلا سبب. */
const MAX_ADDRESSES = 10;

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const identity = await identityFromToken(req);
  if (!identity) {
    return res.status(401).json({
      error: { code: "UNAUTHENTICATED", message_ar: "سجّلِ الدخولَ أوّلاً." },
    });
  }

  const customerModule: any = req.scope.resolve(Modules.CUSTOMER);
  const rows = await customerModule.listCustomerAddresses(
    { customer_id: identity.customer_id },
    { take: MAX_ADDRESSES, order: { created_at: "DESC" } }
  );

  // 🔴 **ولا يُعاد إلا المهيكلُ الكامل.** عناوينُ كُتبت قبل هذه الدفعة
  // — أو من لوحةِ Medusa مباشرةً — تحمل `address_1` بلا حقولنا. وعرضُها
  // في قائمةِ اختيارٍ يعني أن يختارها العميلُ فيُرفض طلبُه بعد خطوتين
  // بسببٍ لا يراه. فتُخفى بدل أن تكذب.
  const addresses = (rows ?? [])
    .map((row: any) => {
      const national = readNationalAddress(row);
      return national ? { id: row.id, is_default: Boolean(row.is_default_shipping), ...national } : null;
    })
    .filter(Boolean);

  return res.json({ addresses });
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const identity = await identityFromToken(req);
  if (!identity) {
    return res.status(401).json({
      error: { code: "UNAUTHENTICATED", message_ar: "سجّلِ الدخولَ أوّلاً." },
    });
  }

  const body = ((req as any).validatedBody ?? req.body ?? {}) as Record<string, unknown>;
  const check = validateNationalAddress(body);
  if (!check.valid) {
    return res.status(400).json({
      error: {
        code: "INVALID_ADDRESS",
        message_ar: "راجعْ حقولَ العنوان المعلَّمة.",
        details: { fields: check.errors },
      },
    });
  }

  const customerModule: any = req.scope.resolve(Modules.CUSTOMER);
  const existing = await customerModule.listCustomerAddresses(
    { customer_id: identity.customer_id },
    { take: MAX_ADDRESSES + 1 }
  );

  if ((existing ?? []).length >= MAX_ADDRESSES) {
    return res.status(409).json({
      error: {
        code: "TOO_MANY_ADDRESSES",
        message_ar: `الحدُّ الأعلى ${MAX_ADDRESSES} عناوين. احذفْ واحداً ثم أعِد المحاولة.`,
      },
    });
  }

  const address = toMedusaAddress(check.value);

  // ── تكرارٌ صامتٌ لا يُنشأ ────────────────────────────────────
  //
  // كلُّ إتمامِ طلبٍ يمرّ بنفس النموذج، فمن حفظ عنوانَه ثم اشترى مرّةً
  // ثانيةً بنفسه يملأ قائمتَه بعشر نُسخٍ من عنوانٍ واحد — ثم يعجز عن
  // تمييزها. والمقارنةُ على **المهيكل** لا على النصّ المركَّب، لأن
  // النصَّ يتغيّر بتغيّر التركيب ونحن نسأل عن نفس المكان.
  const duplicate = (existing ?? []).find((row: any) => {
    const n = readNationalAddress(row);
    if (!n) return false;
    return (
      n.building_number === check.value.building_number &&
      n.postal_code === check.value.postal_code &&
      n.additional_number === check.value.additional_number &&
      n.phone === check.value.phone
    );
  });
  if (duplicate) {
    return res.json({ address: { id: duplicate.id, ...check.value }, created: false });
  }

  const [created] = await customerModule.createCustomerAddresses([
    {
      ...address,
      customer_id: identity.customer_id,
      // أوّلُ عنوانٍ يصير الافتراضيَّ من نفسه: من حفظ عنواناً واحداً
      // لا يريد أن يختاره في كل مرّة.
      is_default_shipping: (existing ?? []).length === 0,
    },
  ]);

  return res.status(201).json({ address: { id: created?.id, ...check.value }, created: true });
}
