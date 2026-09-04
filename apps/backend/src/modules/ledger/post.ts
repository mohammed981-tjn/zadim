import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * كتابةُ القيود — **في معاملةٍ واحدة، وإلا لم يعمل الحارس**.
 *
 * ── ولماذا هنا لا في الخدمة ──────────────────────────────────────
 *
 * لأن قيدَ التوازن **مؤجَّلٌ إلى COMMIT**
 * (`Migration20260904000050`): يُنادى مرّةً بعد أن تُكتب السطورُ
 * كلُّها. وذلك يعني أن السطورَ يجب أن تكون في **معاملةٍ واحدة** — ولو
 * كُتب كلُّ سطرٍ بمعاملته لالتزم الأوّلُ وحدَه فسقط بـ«قيدٌ من سطرٍ
 * واحد»، ولبدا الحارسُ معطوباً وهو سليم.
 *
 * وخدمةُ الوحدة (`MedusaService`) لا تعطي معاملةً تمتدّ على نداءات،
 * فتُكتب هنا باتّصال القاعدة مباشرةً.
 */

export type JournalLine = {
  account: string;
  /** بالهللات صحيحةً: **موجبٌ مدينٌ وسالبٌ دائن**. ولا يُقبل صفر. */
  amount: number;
  note?: string | null;
};

export type JournalInput = {
  kind: "sale" | "payment" | "refund" | "supplier_payment" | "loyalty" | "adjustment";
  source: string;
  reference_type: string;
  reference_id: string;
  actor_id?: string | null;
  currency_code: string;
  occurred_at?: Date;
  note?: string | null;
  lines: JournalLine[];
};

const rid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * قيدٌ واحدٌ بسطوره. ويرمي إن لم يتوازن — **والرميُ من القاعدة لا من
 * هنا**، فلا يُلتفّ عليه بمسارٍ آخر.
 */
export async function postJournal(scope: any, input: JournalInput): Promise<string> {
  const pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);

  // ⚠️ والسطورُ الصفريّةُ تُحذف هنا لا تُرفض: خصمٌ صفرٌ حالةٌ طبيعيةٌ
  // في أكثر الطلبات، ورفضُ القيد كلِّه لأجلها يجعل المُنادي يشترط
  // بنفسه — ثم ينسى في المسار الثاني.
  const lines = input.lines.filter((l) => Math.round(Number(l.amount)) !== 0);
  if (!lines.length) {
    throw new Error("zadim: قيدٌ بلا سطورٍ ذاتِ مبلغ");
  }

  const txId = rid("ltx");
  const occurredAt = input.occurred_at ?? new Date();

  await pg.transaction(async (trx: any) => {
    await trx.raw(
      `insert into "zadim_ledger_transaction"
         ("id","kind","source","reference_type","reference_id","actor_id","currency_code","occurred_at","note")
       values (?,?,?,?,?,?,?,?,?)`,
      [
        txId,
        input.kind,
        input.source,
        input.reference_type,
        input.reference_id,
        input.actor_id ?? null,
        input.currency_code,
        occurredAt,
        input.note ?? null,
      ]
    );

    for (const line of lines) {
      await trx.raw(
        `insert into "zadim_ledger_entry"
           ("id","transaction_id","account","amount","currency_code","note")
         values (?,?,?,?,?,?)`,
        [
          rid("lent"),
          txId,
          line.account,
          Math.round(Number(line.amount)),
          input.currency_code,
          line.note ?? null,
        ]
      );
    }
    // والتوازنُ يُفحص هنا — عند COMMIT، بعد السطور كلِّها.
  });

  return txId;
}

/**
 * قيدُ البيع لطلب — **والذمّةُ هي مجموعُ الطلب لا مجموعُ ما حسبناه**.
 *
 * ── وهذا القرارُ هو أهمُّ ما في الدالّة ──────────────────────────
 *
 * 🔴 `receivable` تساوي **`round(order.total)`** — الرقمَ الذي
 * يُفوتَر ويُحصَّل. ثم تُكتب بقيّةُ السطور من مكوّناتها، **وما تبقّى
 * من فرقِ هللةٍ يُقيَّد `adjustment` بملاحظةٍ صريحة**.
 *
 * والبديلُ المرفوض: أن تكون الذمّةُ مجموعَ ما حسبناه. وحينها يتوازن
 * القيدُ دائماً — **ويختلف عن الفاتورة بهللة**، فلا يظهر الفرقُ في أيّ
 * تقرير، ويُطارَد في تسوية آخر الشهر بلا أثرٍ يدلّ عليه.
 *
 * فالفرقُ **يُقيَّد ولا يُخفى**: سطرُ تسويةٍ يُعدّ ويُجمع ويُقرأ.
 */
export async function postSaleJournal(
  scope: any,
  order: {
    id: string;
    currency_code: string;
    total: unknown;
    item_subtotal: unknown;
    shipping_subtotal: unknown;
    tax_total: unknown;
    discount_total: unknown;
  },
  actorId?: string | null
): Promise<string> {
  const n = (v: unknown) => Math.round(Number(v ?? 0));

  const receivable = n(order.total);
  const itemsNet = n(order.item_subtotal);
  const shipping = n(order.shipping_subtotal);
  const tax = n(order.tax_total);
  const discount = n(order.discount_total);

  // الإيرادُ **إجماليٌّ والخصمُ مصروفٌ مقابل** — لا إيرادٌ مقصوصٌ
  // صامت. فمن يقرأ الدفترَ يرى كم بِيع وكم مُنح، لا الفرقَ وحدَه.
  const itemsGross = itemsNet + discount;

  const lines: JournalLine[] = [
    { account: "receivable", amount: receivable, note: "مجموعُ الطلب كما يُفوتَر" },
    { account: "revenue_items", amount: -itemsGross, note: "إيرادُ الأصناف قبل الخصم" },
    { account: "revenue_shipping", amount: -shipping },
    { account: "vat_payable", amount: -tax },
  ];
  if (discount) lines.push({ account: "discount", amount: discount, note: "خصمٌ ممنوح" });

  const residual = -lines.reduce((a, l) => a + l.amount, 0);
  if (residual !== 0) {
    lines.push({
      account: "adjustment",
      amount: residual,
      note: `فرقُ تقريبٍ بين مجموع الطلب ومكوّناته (${residual} هللة)`,
    });
  }

  return postJournal(scope, {
    kind: "sale",
    source: "checkout",
    reference_type: "order",
    reference_id: order.id,
    actor_id: actorId ?? null,
    currency_code: String(order.currency_code ?? "sar"),
    lines,
  });
}

/**
 * قيدُ استرداد — **مقابلٌ لا ماحٍ**.
 *
 * ولا يلمس قيدَ البيع إطلاقاً: الدفترُ يُلحَق. ومن يقرأ الطلبَ يرى
 * القيدين معاً — بيعٌ وقع، واستردادٌ وقع بعده. وذلك **تاريخُه**، لا
 * سطرٌ واحدٌ عُدّل ليبدو الأمرُ كأنه لم يقع.
 */
export async function postRefundJournal(
  scope: any,
  input: {
    order_id: string;
    currency_code: string;
    amount: number;
    tax_amount?: number;
    actor_id?: string | null;
    note?: string | null;
  }
): Promise<string> {
  const amount = Math.round(Number(input.amount));
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("zadim: مبلغُ الاسترداد بالهللات صحيحةً وموجباً");
  }
  const tax = Math.round(Number(input.tax_amount ?? 0));

  const lines: JournalLine[] = [
    // النقدُ يخرج ⇒ دائن. والإيرادُ يُعكَس ⇒ مدين.
    { account: "cash", amount: -amount, note: "مبلغٌ خرج للعميل" },
    { account: "revenue_items", amount: amount - tax, note: "عكسُ الإيراد" },
  ];
  if (tax) lines.push({ account: "vat_payable", amount: tax, note: "عكسُ الضريبة" });

  return postJournal(scope, {
    kind: "refund",
    source: "returns",
    reference_type: "order",
    reference_id: input.order_id,
    actor_id: input.actor_id ?? null,
    currency_code: input.currency_code,
    note: input.note ?? null,
    lines,
  });
}
