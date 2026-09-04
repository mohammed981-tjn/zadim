import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * أرقامُ العمل — **والمصطلحاتُ تُعرَّف** (§٢٢، والبند ١٫٢ من الخارطة).
 *
 * ── المشكلةُ لم تكن الحساب ──────────────────────────────────────
 *
 * كانت اللوحةُ تُعلن `revenue_halalas` واحداً معناه «مجموعُ مجاميع
 * الطلبات غيرِ الملغاة». وهو رقمٌ **صحيحُ الحساب** — وخاطئُ الاسم:
 * يشمل الضريبةَ (مالُ الدولة لا مالُنا) والشحنَ وما سيُرتجَع. فمن قرأه
 * «إيراداً» قرأ رقماً أكبرَ من الحقيقة بنحو الخُمس، ولا شيءَ في الشاشة
 * يقول له ذلك.
 *
 * فهنا **ثلاثةَ عشرَ رقماً لكلٍّ تعريفٌ مكتوب** في
 * `docs/business-rules.md`، ولكلٍّ ما يُستثنى منه.
 *
 * ── والتغطيةُ تُذكر مع كلّ رقمٍ يعتمد على تكلفة ─────────────────
 *
 * 🔴 صنفٌ بلا تكلفةٍ مسجَّلةٍ لو عُدَّت تكلفتُه صفراً لصار **ربحاً
 * كاملاً** — فيرتفع الهامشُ كلَّما ساء التسجيل، وهو أسوأُ اتّجاهٍ يمكن
 * أن يحمله رقم. فيُستثنى **ويُذكر استثناؤه**: «هامشٌ على ٦٠٪ من
 * السطور» جملةٌ صادقة، و«هامشٌ» وحدَها ليست.
 */

export type OrderFacts = {
  id: string;
  status: string;
  customer_id: string | null;
  total: number;
  discount_total: number;
  tax_total: number;
  shipping_total: number;
  shipping_subtotal: number;
  item_subtotal: number;
};

export type OrderAggregate = {
  gmv_halalas: number;
  orders_count: number;
  orders_all: number;
  canceled_count: number;
  cancel_rate_bp: number;
  aov_halalas: number | null;
  customers_count: number;
  guest_orders: number;
  repeat_customers: number;
  discount_halalas: number;
  tax_halalas: number;
  shipping_halalas: number;
  shipping_net_halalas: number;
  items_net_halalas: number;
};

/** التقريبُ عند حدٍّ واحد — والطلبُ وحدتُه لأنه ما يُحصَّل ويُفوتَر. */
const money = (v: unknown): number => Math.round(Number(v ?? 0));

/**
 * **دالّةٌ خالصةٌ**: صفوفٌ تدخل وأرقامٌ تخرج، بلا قاعدةٍ ولا حاوية.
 * فتُفحص الحدودُ كلُّها (لا طلبات · كلُّها ملغاة · كلُّها ضيوف) بلا
 * بذرِ متجرٍ لكلّ حالة.
 */
export function summarizeOrders(rows: OrderFacts[]): OrderAggregate {
  let gmv = 0;
  let live = 0;
  let canceled = 0;
  let guests = 0;
  let discount = 0;
  let tax = 0;
  let shipping = 0;
  let shippingNet = 0;
  let itemsNet = 0;

  // كم طلباً لكلّ عميل — يخدم `customers_count` و`repeat_customers` معاً.
  const perCustomer = new Map<string, number>();

  for (const o of rows) {
    if (o.status === "canceled") {
      canceled++;
      // ⚠️ **والملغى يخرج من كلّ رقمٍ ماليٍّ لا من الإيراد وحدَه**:
      // ضريبتُه لا تُورَّد، وخصمُه لم يُمنح، وشحنُه لم يُدفَع. وعدُّه
      // في أيٍّ منها يجعل الرقمَ يكبر كلَّما ساءت الأمور.
      continue;
    }

    live++;
    gmv += money(o.total);
    discount += money(o.discount_total);
    tax += money(o.tax_total);
    shipping += money(o.shipping_total);
    shippingNet += money(o.shipping_subtotal);
    itemsNet += money(o.item_subtotal);

    if (o.customer_id) {
      perCustomer.set(o.customer_id, (perCustomer.get(o.customer_id) ?? 0) + 1);
    } else {
      // 🔴 الضيوفُ يُعدّون **طلباتٍ لا أشخاصاً**: لا معرّفَ لهم، فلا
      // سبيلَ إلى معرفة كم شخصاً هم. وعدُّهم عملاءَ يجعل كلَّ ضيفٍ
      // عميلاً جديداً، وحذفُهم صامتين يجعل المتجرَ أصغرَ ممّا هو.
      guests++;
    }
  }

  const all = live + canceled;

  return {
    gmv_halalas: gmv,
    orders_count: live,
    orders_all: all,
    canceled_count: canceled,
    // بالنقاط الأساس: القاعدةُ لا تحمل عشريّاً في حقلٍ ماليّ (ADR-008).
    cancel_rate_bp: all ? Math.round((canceled * 10000) / all) : 0,
    // ⚠️ `null` لا صفر: صفرٌ يُقرأ «متوسّطُ الطلب صفر» — خبرٌ كارثيٌّ
    // عن متجرٍ يعمل، لا خبرٌ عن متجرٍ لم يبِع بعد.
    aov_halalas: live ? Math.round(gmv / live) : null,
    customers_count: perCustomer.size,
    guest_orders: guests,
    repeat_customers: [...perCustomer.values()].filter((n) => n >= 2).length,
    discount_halalas: discount,
    tax_halalas: tax,
    shipping_halalas: shipping,
    shipping_net_halalas: shippingNet,
    items_net_halalas: itemsNet,
  };
}

export type CostedLine = {
  variant_id: string | null;
  quantity: number;
  /** التكلفةُ **يومَ البيع** — أو `null` إن لم تُسجَّل يومَها. */
  unit_cost: number | null;
};

export type MarginResult = {
  cogs_halalas: number;
  contribution_margin_halalas: number;
  margin_covered_lines: number;
  margin_total_lines: number;
};

/**
 * الهامشُ — **ومعه تغطيتُه دائماً**.
 *
 * ⚠️ والسطرُ بلا تكلفةٍ **يخرج من البسط والمقام معاً**: لو بقي في
 * البسط بتكلفةِ صفرٍ لصار ربحاً كاملاً. ولو خرج من البسط وحدَه لصار
 * الهامشُ محسوباً على مبيعاتٍ أكبرَ من تكلفتها المعروفة — وهو نفسُ
 * الكذبة بوجهٍ آخر.
 */
export function computeMargin(lines: CostedLine[], itemsNetOfCovered: number): MarginResult {
  let cogs = 0;
  let covered = 0;

  for (const l of lines) {
    if (l.unit_cost === null) continue;
    covered++;
    cogs += l.unit_cost * l.quantity;
  }

  return {
    cogs_halalas: cogs,
    contribution_margin_halalas: itemsNetOfCovered - cogs,
    margin_covered_lines: covered,
    margin_total_lines: lines.length,
  };
}

/**
 * القراءةُ من مجاميع Medusa المحسوبة — **والفاحصُ يسلك طريقاً آخر**
 * (السطورُ والأجرةُ والتسويّاتُ وأسطرُ الضريبة). ولو قرآ من مكانٍ
 * واحدٍ لصار التطابقُ حتميّاً ولم يحرس شيئاً.
 */
export async function computeBusinessMetrics(scope: any) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY);
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  const { data: orderRows } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "status",
      "customer_id",
      "total",
      "discount_total",
      "tax_total",
      "shipping_total",
      "shipping_subtotal",
      "item_subtotal",
      "created_at",
    ],
  });

  const agg = summarizeOrders(orderRows as OrderFacts[]);

  // ── المستردُّ فعلاً — لا قيمةُ ما طُلب إرجاعُه ─────────────────
  //
  // ⚠️ والفرقُ ليس دقّةً: طلبُ إرجاعٍ لم يُفحص بعدُ لم يُستردّ عنه
  // شيء. وعدُّه يجعل «صافيَ المبيعات» ينخفض قبل أن يقع الحدث، ثمّ
  // يرتفع حين يُرفض الإرجاع — فيقرأ المالكُ تذبذباً لا معنى له.
  const refundRes = await pg.raw(
    `select coalesce(sum(round((os."totals"->>'refunded_total')::numeric)),0)::bigint as v
       from "order_summary" os
       join "order" o on o."id" = os."order_id"
      where o."status" <> 'canceled' and o."deleted_at" is null and os."deleted_at" is null`
  );
  const refunded = Number((refundRes?.rows ?? [])[0]?.v ?? 0);

  const returnsRes = await pg.raw(
    `select count(*)::int as n from "return" where "deleted_at" is null`
  );
  const returnsCount = Number((returnsRes?.rows ?? [])[0]?.n ?? 0);

  // ── قيمةُ المخزون — والتغطيةُ معها ────────────────────────────
  //
  // 🔴 والصنفُ بلا تكلفةٍ **لا يُحسب بصفر**: مخزونٌ قيمتُه «صفر» لأن
  // أحداً لم يُدخل تكلفتَه يبدو مخزوناً بلا قيمة، ويُبنى عليه قرارُ
  // شراء. فيُستثنى ويُذكر عددُه.
  const invRes = await pg.raw(
    `select
       coalesce(sum(l."stocked_quantity" * c."unit_cost"), 0)::bigint as value,
       count(c."id")::int as costed,
       count(*)::int      as total
     from "inventory_level" l
     join "product_variant_inventory_item" pvi
       on pvi."inventory_item_id" = l."inventory_item_id" and pvi."deleted_at" is null
     left join "zadim_variant_cost" c
       on c."variant_id" = pvi."variant_id"
      and c."effective_to" is null and c."deleted_at" is null
     where l."deleted_at" is null`
  );
  const inv = (invRes?.rows ?? [])[0] ?? {};

  // ── التكلفةُ **يومَ البيع** — وهي مجمَّدةٌ على السطر أصلاً ─────
  //
  // 🔴 وهذا صُحِّح بعد قراءة القاعدة لا قبلها: أوّلُ كتابةٍ هنا ربطت
  // سطرَ الطلب بنافذةِ تكلفةٍ في `zadim_variant_cost` حسب تاريخ
  // الطلب — **وذلك مبنيٌّ منذ الدفعة المالية**: مُطلِقُ
  // `zadim_freeze_unit_cost_trg` يكتب `order_line_item.unit_cost`
  // لحظةَ الإدراج.
  //
  // والمجمَّدُ **أصدقُ** من نافذةٍ تُقرأ لاحقاً: سطرُ الطلب يُنسخ من
  // سطر السلّة، فيحمل تكلفةَ **لحظةِ الإضافة إلى السلّة** لا لحظةِ
  // الدفع — وبينهما أسبوعٌ أحياناً. ونافذةٌ تُقرأ بتاريخ الطلب تعطي
  // الثانيةَ وتُسمّيها الأولى.
  const linesRes = await pg.raw(
    `select li."unit_cost",
            oi."quantity"::int as quantity,
            round(oi."quantity" * li."unit_price")::bigint as line_gross,
            coalesce((
              select round(sum(a."amount"))
                from "order_line_item_adjustment" a
               where a."item_id" = li."id" and a."deleted_at" is null
            ), 0)::bigint as line_discount
       from "order_line_item" li
       join "order_item" oi on oi."item_id" = li."id" and oi."deleted_at" is null
       join "order" o on o."id" = oi."order_id"
      where o."status" <> 'canceled' and o."deleted_at" is null and li."deleted_at" is null`
  );

  const lines = (linesRes?.rows ?? []).map((r: any) => ({
    variant_id: null,
    quantity: Number(r.quantity),
    unit_cost: r.unit_cost === null || r.unit_cost === undefined ? null : Number(r.unit_cost),
    // صافي السطر قبل الضريبة وبعد تسويّاته.
    line_net: Number(r.line_gross) - Number(r.line_discount),
  }));

  // ⚠️ والبسطُ **مبيعاتُ السطور المغطّاة وحدَها** لا كلُّ المبيعات:
  // هامشٌ محسوبٌ على مبيعاتٍ أكبرَ من تكلفتها المعروفة هو نفسُ الكذبة
  // بوجهٍ آخر.
  const coveredNet = lines
    .filter((l: any) => l.unit_cost !== null)
    .reduce((a: number, l: any) => a + l.line_net, 0);

  const margin = computeMargin(lines, coveredNet);

  return {
    // ── الحجم ───────────────────────────────────────────────────
    gmv_halalas: agg.gmv_halalas,
    net_sales_halalas: agg.gmv_halalas - refunded,
    orders_count: agg.orders_count,
    orders_all: agg.orders_all,
    aov_halalas: agg.aov_halalas,

    // ── المرتجعاتُ والإلغاء ────────────────────────────────────
    returns_count: returnsCount,
    refunded_halalas: refunded,
    canceled_count: agg.canceled_count,
    cancel_rate_bp: agg.cancel_rate_bp,

    // ── العملاء ────────────────────────────────────────────────
    customers_count: agg.customers_count,
    guest_orders: agg.guest_orders,
    repeat_customers: agg.repeat_customers,

    // ── التركيبُ المالي ────────────────────────────────────────
    discount_halalas: agg.discount_halalas,
    tax_halalas: agg.tax_halalas,
    shipping_halalas: agg.shipping_halalas,
    shipping_net_halalas: agg.shipping_net_halalas,
    items_net_halalas: agg.items_net_halalas,

    // ── التكلفةُ والهامش — **والتغطيةُ معهما دائماً** ──────────
    inventory_value_halalas: Number(inv.value ?? 0),
    inventory_costed_items: Number(inv.costed ?? 0),
    inventory_total_items: Number(inv.total ?? 0),
    cogs_halalas: margin.cogs_halalas,
    contribution_margin_halalas: margin.contribution_margin_halalas,
    margin_covered_lines: margin.margin_covered_lines,
    margin_total_lines: margin.margin_total_lines,

    /** 🔴 التعريفُ يسافر مع الرقم — فلا يُقرأ بتعريفِ من يقرؤه. */
    definitions: "docs/business-rules.md",
  };
}
