import { model } from "@medusajs/framework/utils";

/**
 * عرضُ السعر — **ما رآه العميل ووافق عليه**.
 *
 * ── لماذا يُحفظ أصلاً ────────────────────────────────────────────
 *
 * «تغيّر السعر» سؤالٌ عن **فرقٍ بين لحظتين**، ولحظةُ العرض لا أثرَ لها
 * في قاعدة Medusa: السلّةُ تحمل السعرَ المجمَّد، ولا تحمل متى عُرض ولا
 * على أيّ مجموعٍ وافق العميل. فبلا هذا السجلّ لا يمكن قولُ «تغيّر»
 * أصلاً — يمكن فقط قولُ «هذا هو السعر».
 *
 * والمجاميعُ تُحفظ كاملةً لا المجموعَ وحده: العميلُ يسأل «لماذا زاد
 * ٤٣ ريالاً؟» والجوابُ في الفرق بين الضريبة والشحن، لا في مجموعٍ واحد.
 */
export const CartQuote = model.define("zadim_cart_quote", {
  id: model.id({ prefix: "quote" }).primaryKey(),

  cart_id: model.text(),
  currency_code: model.text(),

  // كلُّها بالهللات، أعداداً صحيحة (ADR-008).
  item_total: model.number(),
  shipping_total: model.number(),
  tax_total: model.number(),
  discount_total: model.number(),
  total: model.number(),

  /** بصمةُ البنود: تفرّق «تغيّر السعر» عن «تغيّرت السلّة». */
  items_fingerprint: model.text(),

  /** لقطةُ البنود كما عُرضت — لعرض الفرق بندًا بندًا. */
  lines: model.json().nullable(),

  /** يُستهلك عند نجاح الإتمام: عرضٌ واحدٌ لطلبٍ واحد. */
  consumed_at: model.dateTime().nullable(),
}).indexes([
  { on: ["cart_id"] },
]);

export default CartQuote;
