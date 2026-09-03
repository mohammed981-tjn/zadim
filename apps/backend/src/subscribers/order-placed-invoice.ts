import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { ZATCA_MODULE } from "../modules/zatca";
import type ZatcaModuleService from "../modules/zatca/service";
import type { IssueInput } from "../modules/zatca/service";
import { readNationalAddress } from "../modules/checkout/national-address";

/**
 * طلبٌ وقع ⇒ فاتورةٌ تُختم في السلسلة.
 *
 * ── 🔴 السلكُ الذي كان مقطوعاً ────────────────────────────────────
 *
 * وحدةُ الفوترة كاملةٌ منذ المرحلة ٦: السلسلةُ والتجزئةُ ورمزُ TLV
 * والقفلُ الذي يُسلسل خمسَ عشرةَ فاتورةً متزامنةً بلا فجوة. وكانت
 * `zatca.issue()` **لا يناديها إلا سكربتُ البوّابة**: لا مشترِكَ ولا
 * مسارَ ولا سيرَ عمل. فالبوّابةُ خضراءُ لأنها تنادي الدالّةَ بيدها،
 * والمتجرُ يبيع بصفرِ فاتورة.
 *
 * وهذا أخطرُ من نقصٍ عاديّ لأن `07-roadmap.md` يضع «تسلسل ZATCA» في
 * جدول **«ما لا يُؤجَّل مهما ضاق الوقت»** بحجّةٍ صحيحة: كلُّ فاتورةٍ
 * كان يجب أن تُختم **لحظةَ إصدارها**، ولا تدخل السلسلةَ بأثرٍ رجعيّ.
 * فألفُ طلبٍ يمرّ بلا هذا المشترِك ألفُ فجوةٍ لا تُسدّ.
 *
 * ── ولماذا مشترِكٌ لا نداءٌ داخل `runCheckout` ────────────────────
 *
 * نفسُ حجّة صندوق الأحداث في `orders/models/outbox-event.ts`: نداءٌ
 * داخل مسارٍ واحد يضيع من كلِّ طريقٍ آخرَ إلى إنشاء الطلب — لوحةُ
 * الإدارة، وسيرُ عملٍ، وتصحيحٌ يدويّ. والحدثُ يراها كلَّها.
 *
 * وأيضاً: الفاتورةُ **لا يجوز أن تُسقط الطلب**. لو نُوديت داخل
 * `runCheckout` لكان فشلُ الفوترة فشلَ شراءٍ — وهذا مقلوب: الطلبُ وقع
 * والمالُ التُزم به، وتعذّرُ ختمِ الفاتورة عطلٌ يُصلَح ويُعاد، لا سببٌ
 * لردّ عميل.
 *
 * ── وما يقع حين لا تُضبط الإعدادات ──────────────────────────────
 *
 * `issue()` يُعيد `ZATCA_NOT_CONFIGURED` ولا يرمي — وهو الصواب: منعُ
 * البيع لأن المالكَ لم يملأ استمارةً بعدُ يوقف المتجرَ لسببٍ إداريّ.
 * ويُكتب **تحذيراً لا معلومة**: متجرٌ يبيع بلا فاتورةٍ حالٌ يجب أن
 * تُرى في السجلّ، لا أن تمرّ بين السطور.
 */

/** يقرأ مبلغاً قد يصل كائنَ BigNumber من طبقة الاستعلام. */
const halalas = (v: unknown): number => Math.round(Number((v as any) ?? 0));

/**
 * نسبةُ الضريبة للسطر — **تُشتقّ من أرقام الطلب لا من ثابتٍ في الكود**.
 *
 * ورقمُ ١٥٪ لا يُكتب هنا: النسبةُ تتغيّر بقرارِ دولة، وفاتورةٌ قديمةٌ
 * يجب أن تحمل نسبةَ يومِها لا نسبةَ اليوم. فتُحسب من الضريبة المحصَّلة
 * فعلاً على أساسِ السطر — وهي ما وقع، لا ما نظنّه وقع.
 */
function vatRateOf(subtotal: number, tax: number): number {
  if (subtotal <= 0) return 0;
  return Math.round((tax / subtotal) * 10000) / 100;
}

export default async function orderPlacedInvoiceHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const zatca = container.resolve(ZATCA_MODULE) as ZatcaModuleService;

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "currency_code",
      "email",
      "created_at",
      "total",
      "tax_total",
      "items.title",
      "items.quantity",
      "items.unit_price",
      "items.subtotal",
      "items.tax_total",
      "items.total",
      "billing_address.first_name",
      "billing_address.last_name",
      "billing_address.city",
      "billing_address.metadata",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "shipping_address.city",
      "shipping_address.metadata",
    ],
    filters: { id: data.id },
  });

  const order = orders[0] as any;
  if (!order) {
    logger.error(`[zadim] فاتورة: لا طلبَ بالمعرّف ${data.id} — لم تُصدَر فاتورة.`);
    return;
  }

  const addr = order.billing_address ?? order.shipping_address ?? null;
  const buyerName = addr
    ? [addr.first_name, addr.last_name].filter(Boolean).join(" ").trim() || null
    : null;

  // 🔴 العنوانُ **مهيكلاً** لا نصّاً مركَّباً.
  //
  // فاتورةُ ZATCA تطلب اسمَ الشارع ورقمَ المبنى والرقمَ الإضافيَّ والحيَّ
  // **حقولاً منفصلة** (street name · building number · plot identification ·
  // city subdivision). وسطرُ عنوانٍ واحدٌ يجعل استخراجَها يومَ الربط
  // تخميناً على بياناتٍ لا تُعاد كتابتُها.
  //
  // وحمولةُ الفاتورة **لا تُعدَّل بعد الإصدار** (ADR-020) — فما لا يُخزَّن
  // اليوم لا يُضاف غداً.
  const national = readNationalAddress(addr);

  const lines: IssueInput["lines"] = ((order.items ?? []) as any[]).map((it) => {
    const subtotal = halalas(it.subtotal);
    const vat = halalas(it.tax_total);
    return {
      description: String(it.title ?? ""),
      quantity: Number(it.quantity) || 0,
      unit_price: halalas(it.unit_price),
      vat_rate: vatRateOf(subtotal, vat),
      line_total: halalas(it.total ?? subtotal + vat),
      vat_amount: vat,
    };
  });

  const result = await zatca.issue({
    order_id: order.id,
    // وقتُ الطلب لا وقتُ المعالجة: مشترِكٌ تأخّر دقيقتين لا يُزيح
    // تاريخَ فاتورةٍ يُحتكم إليه.
    issued_at: order.created_at ? new Date(order.created_at) : undefined,
    currency_code: String(order.currency_code ?? "sar"),
    total: halalas(order.total),
    vat_total: halalas(order.tax_total),
    buyer:
      buyerName || national
        ? { name: buyerName, address: national ?? (addr ? { city: addr.city ?? null } : null) }
        : null,
    lines,
  });

  if (result.issued) {
    logger.info(
      `[zadim] فاتورةٌ صدرت للطلب ${order.display_id ?? order.id} — تسلسل ${result.invoice.sequence}.`
    );
    return;
  }

  if (result.code === "ALREADY_ISSUED") {
    // حدثٌ وصل مرّتين، أو أُعيد تشغيلُ الطابور. وهذا **ليس عطلاً**:
    // `issue()` يمنع التكرار بنفسه، والسلسلةُ تبقى بلا ازدواج.
    return;
  }

  logger.warn(
    `[zadim] ⚠️ الطلب ${order.display_id ?? order.id} تمّ **بلا فاتورة**: ${result.reason_ar} ` +
      `اضبط إعدادات الفوترة من /admin/zatca/settings — والفواتيرُ الفائتة لا تدخل السلسلةَ بأثرٍ رجعيّ.`
  );
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
