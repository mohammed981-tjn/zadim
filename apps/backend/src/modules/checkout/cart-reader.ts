import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils";
import type { CartLine } from "./pricing";
import { amount } from "./pricing";

/**
 * قراءةُ السلّة وأسعارِها الحاليّة — مشتركةٌ بين `/quote` و`/checkout`.
 *
 * ── لماذا هنا لا في `service.ts` ────────────────────────────────
 *
 * **خدمةُ الوحدة لا تقرأ سلّةً بنفسها**: تأخذ الصفوفَ معطىً كي يبقى
 * منطقُ «تغيّر السعر» قابلاً للاختبار بصفوفٍ مكتوبةٍ بخطّ اليد، بلا
 * سلّةٍ ولا منتجٍ ولا قاعدة. وهذا الملفُّ هو الجسر: يعرف شكلَ ردّ
 * الاستعلام ويحوّله إلى ما تفهمه الدوالُّ الخالصة.
 */

export const CART_FIELDS = [
  "id",
  "currency_code",
  "region_id",
  "sales_channel_id",
  "email",
  "completed_at",
  "total",
  "subtotal",
  "item_total",
  "tax_total",
  "shipping_total",
  "discount_total",
  "shipping_address.city",
  // الجوّالُ مفتاحُ عميل COD (`payments/cod.ts` → `customerKey`): بلا
  // قراءتِه هنا يسقط المفتاحُ إلى البريد وحدَه، فيُفلت من عدّ الرفضات
  // من طلب بجوّالِه ولا بريدَ له — وهم أكثرُ من يطلب بالدفع عند الاستلام.
  "shipping_address.phone",
  "items.id",
  "items.title",
  "items.variant_id",
  "items.quantity",
  "items.unit_price",
];

export async function readCart(scope: any, id: string): Promise<any | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: "cart", fields: CART_FIELDS, filters: { id } });
  return (data[0] as any) ?? null;
}

export function cartLines(cart: any): CartLine[] {
  return ((cart?.items ?? []) as any[]).map((i) => ({
    id: i.id,
    variant_id: i.variant_id,
    title: i.title ?? null,
    quantity: Number(i.quantity) || 0,
    unit_price: amount(i.unit_price),
  }));
}

/**
 * السعرُ الحاليُّ لكل متغيّرٍ **من المصدر** — لا من السلّة.
 *
 * وهذه هي الخطوةُ الأولى في ترتيب الإتمام السبعة
 * (`04-api-contract.md`)، والتي **لا يفعلها Medusa إطلاقاً**: قِيس أن
 * السعرَ يُجمَّد عند الإضافة ولا يُقرأ ثانيةً، لا عند العرض ولا عند
 * `refreshCartItems` ولا عند الإتمام.
 *
 * والمتغيّرُ الذي لا سعرَ له في هذا السياق يُعاد بـ`null` لا بصفر:
 * «لا سعر» و«بالمجّان» ليسا واحداً.
 */
export async function currentPrices(
  scope: any,
  cart: any
): Promise<Map<string, number | null>> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const ids = [...new Set(cartLines(cart).map((l) => l.variant_id).filter(Boolean))];
  const out = new Map<string, number | null>();
  if (!ids.length) return out;

  const { data } = await query.graph({
    entity: "variant",
    fields: ["id", "calculated_price.*"],
    filters: { id: ids },
    context: {
      calculated_price: QueryContext({
        region_id: cart.region_id,
        currency_code: cart.currency_code,
      }),
    },
  });

  for (const v of data as any[]) {
    const calc = v?.calculated_price?.calculated_amount;
    out.set(v.id, calc === null || calc === undefined ? null : amount(calc));
  }
  for (const id of ids) if (!out.has(id)) out.set(id, null);

  return out;
}

/** شكلُ الخطأ الموحَّد في العقد: `{ error: { code, message_ar, details } }`. */
export function fail(
  res: any,
  status: number,
  code: string,
  message_ar: string,
  details?: unknown
) {
  return res.status(status).json({ error: { code, message_ar, details } });
}
