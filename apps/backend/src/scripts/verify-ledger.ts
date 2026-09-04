import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { postJournal, postSaleJournal, postRefundJournal } from "../modules/ledger/post";

/**
 * بوّابةُ دفتر القيود (البند ١٫٣).
 *
 * ── وشرطُ القبول يُؤخذ حرفياً ────────────────────────────────────
 *
 * > مجموعُ قيود طلبٍ = مجموعُه المحصَّل **بفرقٍ صفر** · والقيدُ **لا
 * > يُعدَّل** (يُثبَت بالنقض) · واستردادٌ يُنتج قيداً **مقابلاً لا
 * > يمحو الأصل**.
 *
 * 🔴 **وأخطرُ ما تحرسه أن التوازنَ خاصّةُ القاعدة لا عادةُ الكود.**
 * فدفترٌ يتوازن لأن الدالّةَ التي تكتبه منضبطةٌ يختلّ أوّلَ يومٍ يكتب
 * فيه أحدٌ من مسارٍ آخر — سكربتٍ أو `psql`. ولذلك تُكتب هنا قيودٌ
 * مختلّةٌ **بجملِ SQL مباشرة**، ويجب أن ترفضها القاعدة.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-ledger.ts
 */
export default async function verifyLedger({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `lg-${Date.now()}`;

  const sumOf = async (txId: string) => {
    const r = await pg.raw(
      `select coalesce(sum("amount"),0)::bigint as v, count(*)::int as n
         from "zadim_ledger_entry" where "transaction_id" = ?`,
      [txId]
    );
    const row = (r?.rows ?? [])[0] ?? {};
    return { sum: Number(row.v ?? 0), lines: Number(row.n ?? 0) };
  };

  // ── ١) دليلُ الحسابات — بياناتٌ لا كود ──────────────────────
  logger.info("== دليلُ الحسابات ==");

  const accounts = await pg.raw(
    `select count(*)::int as n from "zadim_ledger_account" where "deleted_at" is null`
  );
  Number((accounts?.rows ?? [])[0]?.n ?? 0) >= 10
    ? pass(`الحساباتُ صفوفٌ (${(accounts.rows)[0].n}) — لا \`enum\` في الكود`)
    : fail("دليلُ الحسابات ناقص");

  // 🔴 ولا حسابَ يُخترع في سطر كود: المفتاحُ الأجنبيّ يمنعه.
  let ghost = false;
  try {
    await postJournal(container, {
      kind: "adjustment",
      source: "gate",
      reference_type: "gate",
      reference_id: tag,
      currency_code: "sar",
      lines: [
        { account: "revenue_item", amount: 100 }, // بلا s — خطأٌ مطبعيّ
        { account: "cash", amount: -100 },
      ],
    });
    ghost = true;
  } catch {
    /* المفتاحُ رفض — وهو المطلوب */
  }
  !ghost
    ? pass("وحسابٌ مخترَعٌ (`revenue_item` بلا s) **يُرفض** — لا حسابَ شبحٍ يذهب إليه المال")
    : fail("قُبل حسابٌ لا وجودَ له في الدليل");

  // ── ٢) 🔴 التوازنُ يقع عند الالتزام ────────────────────────
  logger.info("== والتوازنُ خاصّةُ القاعدة ==");

  const balanced = await postJournal(container, {
    kind: "adjustment",
    source: "gate",
    reference_type: "gate",
    reference_id: tag,
    currency_code: "sar",
    note: "قيدٌ متوازن",
    lines: [
      { account: "cash", amount: 7313 },
      { account: "revenue_items", amount: -7313 },
    ],
  });
  const b = await sumOf(balanced);
  b.sum === 0 && b.lines === 2
    ? pass("قيدٌ متوازنٌ يُكتب (سطران، مجموعُهما صفر)")
    : fail(`القيدُ المتوازن: مجموعٌ ${b.sum} وسطورٌ ${b.lines}`);

  // 🔴 **والنقض**: قيدٌ مختلٌّ يُكتب **بجمل SQL مباشرةً** — لا عبر
  // `postJournal` — ويجب أن ترفضه القاعدةُ عند COMMIT.
  //
  // ولو كان الحارسُ في `postJournal` وحدَه لمرّ هذا، ولاختلّ الدفترُ
  // أوّلَ يومٍ يكتب فيه سكربتٌ أو مشغّل.
  let crooked = false;
  try {
    await pg.transaction(async (trx: any) => {
      const id = `ltx_bad_${tag}`;
      await trx.raw(
        `insert into "zadim_ledger_transaction"
           ("id","kind","source","reference_type","reference_id","currency_code","occurred_at")
         values (?, 'adjustment','gate','gate',?,'sar', now())`,
        [id, tag]
      );
      await trx.raw(
        `insert into "zadim_ledger_entry" ("id","transaction_id","account","amount","currency_code")
         values (?, ?, 'cash', 5000, 'sar')`,
        [`lent_bad1_${tag}`, id]
      );
      await trx.raw(
        `insert into "zadim_ledger_entry" ("id","transaction_id","account","amount","currency_code")
         values (?, ?, 'revenue_items', -4000, 'sar')`,
        [`lent_bad2_${tag}`, id]
      );
      // ينقص ١٠٠٠ — ويجب أن يسقط الالتزام.
    });
    crooked = true;
  } catch (e) {
    /* رُفض عند COMMIT — وهو المطلوب */
  }
  !crooked
    ? pass("وقيدٌ مختلٌّ مكتوبٌ بـSQL مباشرةً **يسقط عند COMMIT** — لا من الكود بل من القاعدة")
    : fail("التُزم قيدٌ لا يتوازن — والحارسُ في الكود وحدَه");

  // وما سقط لم يبقَ منه شيء: المعاملةُ تُرجَع كلُّها.
  const leftover = await pg.raw(
    `select count(*)::int as n from "zadim_ledger_entry" where "transaction_id" = ?`,
    [`ltx_bad_${tag}`]
  );
  Number((leftover?.rows ?? [])[0]?.n ?? 0) === 0
    ? pass("ولم يبقَ من الساقط سطرٌ واحد — المعاملةُ تُرجَع كلُّها")
    : fail("بقيت سطورٌ من قيدٍ سقط");

  // ⚠️ وسطرٌ واحدٌ لا يكون قيداً.
  let lonely = false;
  try {
    await pg.transaction(async (trx: any) => {
      const id = `ltx_one_${tag}`;
      await trx.raw(
        `insert into "zadim_ledger_transaction"
           ("id","kind","source","reference_type","reference_id","currency_code","occurred_at")
         values (?, 'adjustment','gate','gate',?,'sar', now())`,
        [id, tag]
      );
      await trx.raw(
        `insert into "zadim_ledger_entry" ("id","transaction_id","account","amount","currency_code")
         values (?, ?, 'cash', 0, 'sar')`,
        [`lent_one_${tag}`, id]
      );
    });
    lonely = true;
  } catch {
    /* رُفض — إمّا بقيد «لا صفر» أو بقيد التوازن */
  }
  !lonely
    ? pass("وسطرٌ بمبلغ صفرٍ يُرفض — سطرٌ بلا مبلغٍ ضجيجٌ يُخفي ما يهمّ")
    : fail("قُبل سطرٌ بصفر");

  // ── ٣) الدفترُ يُلحَق ولا يُمسّ ────────────────────────────
  logger.info("== والدفترُ يُلحَق ولا يُمسّ ==");

  await pg.raw(`update "zadim_ledger_entry" set "amount" = 1 where "transaction_id" = ?`, [
    balanced,
  ]);
  await pg.raw(`delete from "zadim_ledger_entry" where "transaction_id" = ?`, [balanced]);
  const after = await sumOf(balanced);
  after.sum === 0 && after.lines === 2
    ? pass("و`update` و`delete` بلا أثر — التصحيحُ بقيدٍ مقابلٍ لا بمسحِ الماضي")
    : fail(`الدفترُ قَبِل تعديلاً أو حذفاً: ${JSON.stringify(after)}`);

  // ── ٤) 🔴 قيدُ طلبٍ حقيقيّ = مجموعُه المحصَّل بفرقٍ صفر ────
  logger.info("== وقيدُ الطلب يساوي مجموعَه المحصَّل ==");

  const { data: sample } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "currency_code",
      "total",
      "item_subtotal",
      "shipping_subtotal",
      "tax_total",
      "discount_total",
    ],
  });
  const orders = (sample as any[]).filter((o) => Number(o.total) > 0).slice(0, 12);

  if (!orders.length) {
    fail("لا طلباتٍ في القاعدة لفحص قيد البيع");
  } else {
    let mismatched = 0;
    let residuals = 0;
    for (const o of orders) {
      const txId = await postSaleJournal(container, o, `gate-${tag}`);
      const { sum } = await sumOf(txId);
      if (sum !== 0) mismatched++;

      // والذمّةُ **هي مجموعُ الطلب** لا مجموعُ ما حسبناه.
      const r = await pg.raw(
        `select "amount"::bigint as v from "zadim_ledger_entry"
          where "transaction_id" = ? and "account" = 'receivable'`,
        [txId]
      );
      const receivable = Number((r?.rows ?? [])[0]?.v ?? -1);
      if (receivable !== Math.round(Number(o.total))) mismatched++;

      const adj = await pg.raw(
        `select count(*)::int as n from "zadim_ledger_entry"
          where "transaction_id" = ? and "account" = 'adjustment'`,
        [txId]
      );
      residuals += Number((adj?.rows ?? [])[0]?.n ?? 0);
    }

    mismatched === 0
      ? pass(
          `و${orders.length} طلباً: الذمّةُ = مجموعُ الطلب **بفرقٍ صفر**، والقيدُ متوازن`
        )
      : fail(`${mismatched} انحرافاً في ${orders.length} طلباً`);

    // ⚠️ وفرقُ التقريبِ يُقيَّد ولا يُخفى — ويُقال كم وقع.
    pass(
      `وفروقُ التقريب مقيَّدةٌ لا مخفيّة: ${residuals} سطرَ تسويةٍ في ${orders.length} طلباً`
    );
  }

  // ── ٥) 🔴 والاستردادُ **مقابلٌ لا ماحٍ** ───────────────────
  logger.info("== والاستردادُ لا يمحو الأصل ==");

  if (orders.length) {
    const target = orders[0];
    const before = await pg.raw(
      `select count(*)::int as n from "zadim_ledger_transaction"
        where "reference_type" = 'order' and "reference_id" = ? and "kind" = 'sale'`,
      [target.id]
    );
    const salesBefore = Number((before?.rows ?? [])[0]?.n ?? 0);

    const refundTx = await postRefundJournal(container, {
      order_id: target.id,
      currency_code: String(target.currency_code ?? "sar"),
      amount: 5000,
      tax_amount: 652,
      actor_id: `gate-${tag}`,
      note: "بوّابة",
    });

    const rf = await sumOf(refundTx);
    rf.sum === 0
      ? pass("قيدُ الاسترداد متوازن")
      : fail(`قيدُ الاسترداد لا يتوازن: ${rf.sum}`);

    const afterSales = await pg.raw(
      `select count(*)::int as n from "zadim_ledger_transaction"
        where "reference_type" = 'order' and "reference_id" = ? and "kind" = 'sale'`,
      [target.id]
    );
    Number((afterSales?.rows ?? [])[0]?.n ?? 0) === salesBefore
      ? pass("**وقيدُ البيع باقٍ كما هو** — الاستردادُ أضاف ولم يمحُ")
      : fail("تغيّر قيدُ البيع بعد الاسترداد");

    // والنقدُ خرج: الأثرُ يُقاس على الحساب لا على الردّ.
    const cash = await pg.raw(
      `select "amount"::bigint as v from "zadim_ledger_entry"
        where "transaction_id" = ? and "account" = 'cash'`,
      [refundTx]
    );
    Number((cash?.rows ?? [])[0]?.v ?? 0) === -5000
      ? pass("والنقدُ خرج ٥٠٠٠ هللة — دائنٌ لا مدين")
      : fail(`اتّجاهُ النقد خاطئ: ${JSON.stringify((cash?.rows ?? [])[0])}`);

    // 🔴 واستردادٌ بمبلغٍ غيرِ موجبٍ يُرفض قبل أن يُكتب شيء.
    let bad = false;
    try {
      await postRefundJournal(container, {
        order_id: target.id,
        currency_code: "sar",
        amount: -100,
      });
      bad = true;
    } catch {
      /* مرفوض */
    }
    !bad
      ? pass("واستردادٌ بمبلغٍ سالبٍ يُرفض — ولا يصير إيداعاً بالخطأ")
      : fail("قُبل استردادٌ بمبلغٍ سالب");
  }

  // ── ٦) مطابقةٌ: طلباتٌ بلا قيد ─────────────────────────────
  //
  // ⚠️ **وهذا الرقمُ لا يُخفى**: قيدُ البيع يُكتب في مسار الإتمام ولا
  // يُسقط الطلبَ إن تعذّر (الطلبُ وقع والمالُ التُزم به). فالفجوةُ
  // ممكنة، **والمطلوبُ أن تُرى** — لا أن يُدَّعى أنها مستحيلة.
  const gap = await pg.raw(
    `select count(*)::int as n from "order" o
      where o."deleted_at" is null and o."status" <> 'canceled'
        and not exists (
          select 1 from "zadim_ledger_transaction" t
           where t."reference_type" = 'order' and t."reference_id" = o."id"
             and t."kind" = 'sale'
        )`
  );
  const missing = Number((gap?.rows ?? [])[0]?.n ?? 0);
  logger.info(
    `  ℹ️ طلباتٌ بلا قيدِ بيع: ${missing} — ` +
      `وهي قابلةٌ للقيد بأثرٍ رجعيٍّ لأن مكوّناتِها باقيةٌ في الطلب ` +
      `(بخلاف الفاتورة، والفائتُ منها لا يُستدرَك أبداً).`
  );

  if (failures > 0) {
    logger.error(`⛔ سقط ${failures} فحصاً.`);
    process.exit(1);
  }
  logger.info("✅ بوّابةُ دفتر القيود اجتازت — والتوازنُ من القاعدة لا من الكود.");
}
