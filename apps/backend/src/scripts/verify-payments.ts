import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { PAYMENTS_MODULE } from "../modules/payments";
import type PaymentsModuleService from "../modules/payments/service";
import { codEligibility, customerKey } from "../modules/payments/cod";
import { ZATCA_MODULE } from "../modules/zatca";
import type ZatcaModuleService from "../modules/zatca/service";
import { buildQrTlv, halalasToDecimal, parseQrTlv } from "../modules/zatca/tlv";
import { genesisHash } from "../modules/zatca/chain";

/**
 * بوّابةُ المرحلة ٦ — المدفوعات (`07-roadmap.md`).
 *
 * > التحصيلُ عند **الشحن** لا عند الطلب · استردادٌ يتجاوز المحصَّل
 * > **مستحيلٌ بالقيد** · نداءٌ مكرَّر بنفس `Idempotency-Key` **لا
 * > يُحصّل مرتين** · فاتورةُ ZATCA تُصدَر **بتسلسلٍ غير منقطع وتجزئةٍ
 * > مرتبطة**.
 *
 * ⚠️ **ولا تُشغَّل على قاعدةٍ حقيقية**: تُنشئ إعداداتِ فوترةٍ برقمٍ
 * ضريبيٍّ أصفارٍ كلِّه (`000000000000000`) — رقمٌ لا يمكن أن يُخطئ أحدٌ
 * فيحسبه رقمَ منشأة — وتُصدر تحته فواتيرَ لا تُحذف. وهذا حالُ كل
 * بوّاباتنا: تكتب في قاعدةٍ تُخلق وتموت مع التشغيلة.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-payments.ts
 */

const GATE_VAT = "000000000000000";

export default async function verifyPayments({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const payments = container.resolve(PAYMENTS_MODULE) as PaymentsModuleService;
  const zatca = container.resolve(ZATCA_MODULE) as ZatcaModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `vpay-${Date.now()}`;
  const madeSettings: string[] = [];
  const madePolicies: string[] = [];
  // سياساتٌ كانت حيّةً قبلنا وحُذفت حذفاً ليّناً — تُعاد في `finally`.
  const restoreEnabled: string[] = [];
  /** إعداداتُ فوترةٍ قائمةٌ نُخفيها لحظةَ فحص «بلا إعدادات» ثم نُعيدها. */
  const restoreSettings: string[] = [];
  const madeMoney: Array<[string, string]> = [];
  const madeOrders: string[] = [];
  const madeFulfilments: string[] = [];

  try {
    // ── ١) أهليّةُ COD — منطقٌ خالصٌ بلا رقمٍ مبرمَج ─────────────
    logger.info("== الدفعُ عند الاستلام: المنطق ==");

    const noPolicy = codEligibility({ policy: null, order_total: 10000 });
    !noPolicy.eligible && noPolicy.code === "COD_DISABLED"
      ? pass("بلا سياسةٍ: **يُمنع** — وغيابُ الصفّ ليس موافقة")
      : fail("COD مسموحٌ بلا سياسة");

    const openPolicy = { is_enabled: true };
    codEligibility({ policy: openPolicy, order_total: 999_999_99 }).eligible
      ? pass("سياسةٌ بلا حدود ⇒ أيُّ مبلغ — **لا رقمَ افتراضيَّ في الكود**")
      : fail("ثمّةَ حدٌّ مبرمَجٌ في مكانٍ ما");

    const capped = { is_enabled: true, max_order_total: 100000, min_order_total: 5000 };
    const above = codEligibility({ policy: capped, order_total: 100001 });
    !above.eligible && above.code === "COD_ABOVE_LIMIT"
      ? pass("فوق الحدّ الأعلى ⇒ COD_ABOVE_LIMIT")
      : fail(`المتوقّع COD_ABOVE_LIMIT: ${JSON.stringify(above)}`);

    codEligibility({ policy: capped, order_total: 100000 }).eligible
      ? pass("وعند الحدّ بالضبط يمرّ — الحدُّ شاملٌ لا حاجز")
      : fail("الحدُّ الأعلى يرفض قيمتَه نفسَها");

    const below = codEligibility({ policy: capped, order_total: 4999 });
    !below.eligible && below.code === "COD_BELOW_MINIMUM"
      ? pass("دون الحدّ الأدنى ⇒ COD_BELOW_MINIMUM")
      : fail(`المتوقّع COD_BELOW_MINIMUM: ${JSON.stringify(below)}`);

    const cityPolicy = { is_enabled: true, excluded_cities: ["أبها"] };
    const excluded = codEligibility({ policy: cityPolicy, order_total: 5000, city: "أبها" });
    !excluded.eligible && excluded.code === "COD_CITY_EXCLUDED"
      ? pass("مدينةٌ مستثناة ⇒ COD_CITY_EXCLUDED")
      : fail(`المتوقّع COD_CITY_EXCLUDED: ${JSON.stringify(excluded)}`);

    codEligibility({ policy: cityPolicy, order_total: 5000, city: "الرياض" }).eligible
      ? pass("وغيرُها يمرّ")
      : fail("مدينةٌ غيرُ مستثناةٍ رُفضت");

    const blockPolicy = { is_enabled: true, refusals_before_block: 2 };
    const blocked = codEligibility({ policy: blockPolicy, order_total: 5000, refusals: 2 });
    !blocked.eligible && blocked.code === "COD_CUSTOMER_BLOCKED"
      ? pass("رفضتان والعتبةُ اثنتان ⇒ COD_CUSTOMER_BLOCKED")
      : fail(`المتوقّع COD_CUSTOMER_BLOCKED: ${JSON.stringify(blocked)}`);

    codEligibility({ policy: blockPolicy, order_total: 5000, refusals: 1 }).eligible
      ? pass("ورفضةٌ واحدةٌ لا تمنع — العتبةُ بياناتٌ لا حكمٌ ثابت")
      : fail("رفضةٌ واحدةٌ منعت");

    // مفتاحُ العميل: صورٌ ثلاثٌ لرقمٍ واحد
    const keys = [
      customerKey({ phone: "+966501234567" }),
      customerKey({ phone: "0501234567" }),
      customerKey({ phone: "٠٥٠١٢٣٤٥٦٧" }),
      customerKey({ phone: "00966 50 123 4567" }),
    ];
    new Set(keys).size === 1
      ? pass(`أربعُ صورٍ للجوّال ⇒ مفتاحٌ واحد (${keys[0]})`)
      : fail(`المفاتيح اختلفت: ${JSON.stringify(keys)}`);

    customerKey({ email: "A@Zadim.Test" }) === "a@zadim.test"
      ? pass("وبلا جوّالٍ يُستعمل البريدُ بحروفٍ صغيرة")
      : fail("البريدُ لم يُطبَّع");

    // ── ٢) السياسةُ والرفضاتُ من القاعدة ────────────────────────
    logger.info("== السياسةُ والرفضاتُ من القاعدة ==");

    // ⚠️ **والمقعدُ واحدٌ وقد يكون مشغولاً قبلنا.** الفهرسُ
    // `IDX_zadim_cod_policy_single` هو `UNIQUE ((true)) WHERE deleted_at
    // IS NULL` — أي **صفٌّ واحدٌ حيٌّ لا غير**، نافذاً كان أو مُطفأً.
    // فصفٌّ باقٍ من تشغيلةٍ انقطعت قبل تنظيفها يُسقِط الفحصَ بـ«already
    // exists»: لا لأن الحارس انكسر بل لأن المقعد مشغول. وCI يبدأ بقاعدةٍ
    // جديدةٍ فلا يراه أبداً — فيسقط على جهاز المطوّر وحدَه ويُقرأ عطلَ
    // كودٍ ثم يُتجاهَل.
    //
    // فيُخلى المقعدُ بحذفٍ ليّنٍ **ويُعاد شاغلُه في `finally`** — لا
    // يُحذف حذفاً باتّاً: قد يكون سياسةَ متجرٍ حقيقيّ.
    const foreign = await pg("zadim.zadim_cod_policy").whereNull("deleted_at").select("id");
    const foreignIds = (foreign as any[]).map((r) => r.id);
    if (foreignIds.length) {
      await pg("zadim.zadim_cod_policy").whereIn("id", foreignIds).update({ deleted_at: new Date() });
      restoreEnabled.push(...foreignIds);
    }

    const [policyRow] = await payments.createCodPolicies([
      {
        is_enabled: true,
        max_order_total: 200000,
        refusals_before_block: 2,
        note: `بوّابة ${tag}`,
      },
    ]);
    madePolicies.push(policyRow.id);

    let dup = false;
    try {
      const [p2] = await payments.createCodPolicies([{ is_enabled: false }]);
      madePolicies.push(p2.id);
    } catch {
      dup = true;
    }
    dup
      ? pass("سياسةٌ واحدةٌ نافذة — الثانيةُ يردّها القيد")
      : fail("سياستان نافذتان: الحكمُ يعتمد على أيِّهما قُرئت أوّلاً");

    // ⚠️ **جوّالٌ خاصٌّ بهذه التشغيلة**. كان ثابتاً، فتراكمت رفضاتُه
    // بين تشغيلتين وصار «رفضتان» أربعاً — **فنجح الفحصُ مرّةً وسقط في
    // كل إعادة**. واختبارٌ كهذا يُتجاهَل في CI بدل أن يُصلَح.
    const phone = `0555${String(Date.now()).slice(-6)}`;
    const key = customerKey({ phone });
    const decision1 = await payments.codDecision({ order_total: 50000, phone });
    decision1.eligible
      ? pass("عميلٌ بلا رفضاتٍ يمرّ من القاعدة")
      : fail(`رُفض بلا سبب: ${JSON.stringify(decision1)}`);

    await payments.createCodRefusals([
      { customer_key: key, reason_ar: "لم يستلم", order_id: null },
      { customer_key: key, reason_ar: "لم يردّ", order_id: null },
    ]);

    // نفسُ الرقم بالأرقام الهندية — والمفتاحُ يجب أن يتطابق.
    const indic = phone.replace(/[0-9]/g, (d) => String.fromCharCode(0x660 + Number(d)));
    const decision2 = await payments.codDecision({ order_total: 50000, phone: indic });
    !decision2.eligible && decision2.code === "COD_CUSTOMER_BLOCKED" && decision2.refusals === 2
      ? pass("رفضتان مقيَّدتان ⇒ يُمنع — **ولو كتب رقمَه بالهندية**")
      : fail(`الحكمُ بعد الرفضات: ${JSON.stringify(decision2)}`);

    const aboveLimit = await payments.codDecision({ order_total: 200001, phone: "0555999888" });
    !aboveLimit.eligible && aboveLimit.code === "COD_ABOVE_LIMIT"
      ? pass("والحدُّ من القاعدة يُطبَّق")
      : fail(`الحدّ لم يُطبَّق: ${JSON.stringify(aboveLimit)}`);

    // الرفضةُ واقعةٌ لا تُمحى
    const refusals = await payments.listCodRefusals({ customer_key: key });
    const beforeDelete = refusals.length;
    await pg("zadim.zadim_cod_refusal").where({ id: (refusals[0] as any).id }).del();
    (await payments.listCodRefusals({ customer_key: key })).length === beforeDelete
      ? pass("رفضةٌ وقعت لا تُحذف — ومن أراد الصفحَ يرفع العتبة")
      : fail("حُذفت رفضة");

    // ── ٣) 🔴 التحصيلُ عند الشحن لا عند الطلب ───────────────────
    logger.info("== التحصيلُ عند الشحن ==");

    const linked = await pg.raw(`
      select p."id" as payment_id, opc."order_id"
        from "zadim"."payment" p
        join "zadim"."order_payment_collection" opc
          on opc."payment_collection_id" = p."payment_collection_id"
       where opc."deleted_at" is null
       limit 1
    `);
    const row = (linked?.rows ?? linked)[0];

    if (!row) {
      fail("لا دفعةً مرتبطةً بطلب — شغّل verify-checkout أوّلاً");
    } else {
      const capId = `cap_${tag}`;
      let blockedBeforeShip = false;
      try {
        await pg.raw(
          `insert into "zadim"."capture" ("id","payment_id","amount","raw_amount")
           values (?, ?, 10000, jsonb_build_object('value','10000','precision',20))`,
          [capId, row.payment_id]
        );
        madeMoney.push(["capture", capId]);
      } catch {
        blockedBeforeShip = true;
      }
      blockedBeforeShip
        ? pass("**تحصيلٌ قبل الشحن مرفوض** — فما يُلغى قبل الشحن لا يُحصَّل")
        : fail("مرّ تحصيلٌ قبل الشحن");

      // تُشحن شحنةٌ، فيُقبل التحصيل
      const fid = `ful_${tag}`;
      await pg.raw(
        `insert into "zadim"."fulfillment" ("id","location_id","provider_id","shipped_at","packed_at")
         values (?, 'sloc_gate', 'manual_manual', now(), now())`,
        [fid]
      );
      madeFulfilments.push(fid);
      await pg.raw(
        `insert into "zadim"."order_fulfillment" ("id","order_id","fulfillment_id") values (?, ?, ?)`,
        [`ofu_${tag}`, row.order_id, fid]
      );

      await pg.raw(
        `insert into "zadim"."capture" ("id","payment_id","amount","raw_amount")
         values (?, ?, 10000, jsonb_build_object('value','10000','precision',20))`,
        [capId, row.payment_id]
      );
      madeMoney.push(["capture", capId]);
      pass("وبعد الشحن يمرّ التحصيل");

      // والاستردادُ لا يتجاوزه
      const refId = `ref_${tag}`;
      await pg.raw(
        `insert into "zadim"."refund" ("id","payment_id","amount","raw_amount")
         values (?, ?, 4000, jsonb_build_object('value','4000','precision',20))`,
        [refId, row.payment_id]
      );
      madeMoney.push(["refund", refId]);

      let overRefund = false;
      try {
        const r2 = `ref_${tag}_b`;
        await pg.raw(
          `insert into "zadim"."refund" ("id","payment_id","amount","raw_amount")
           values (?, ?, 7000, jsonb_build_object('value','7000','precision',20))`,
          [r2, row.payment_id]
        );
        madeMoney.push(["refund", r2]);
      } catch {
        overRefund = true;
      }
      overRefund
        ? pass("واستردادٌ يتجاوز المحصَّل مستحيل")
        : fail("مرّ استردادٌ فوق المحصَّل");
    }

    // ── ٤) لا يُحصَّل مرّتين ────────────────────────────────────
    logger.info("== نداءٌ مكرَّر بنفس المفتاح ==");

    const mkey = `mop-${tag}`;
    const [a, b] = await Promise.all([
      payments.claim(mkey, "capture", { amount: 10000 }),
      payments.claim(mkey, "capture", { amount: 10000 }),
    ]);
    const claimed = [a, b].filter((r) => r.fresh).length;
    const [, opCount] = await payments.listAndCountMoneyOperations({ idempotency_key: mkey });

    claimed === 1 && opCount === 1
      ? pass("نداءان متزامنان بنفس المفتاح ⇒ **عمليةٌ واحدة**")
      : fail(`حُجز ${claimed} وصفوفُه ${opCount}`);

    // ── ٥) ZATCA — الترميز ──────────────────────────────────────
    logger.info("== ZATCA: رمزُ QR ==");

    const decimals: Array<[number, string]> = [
      [1, "0.01"],
      [99, "0.99"],
      [100, "1.00"],
      [12345, "123.45"],
      [1000000, "10000.00"],
    ];
    const badDecimal = decimals.find(([h, want]) => halalasToDecimal(h) !== want);
    !badDecimal
      ? pass("الهللاتُ ⇒ عشريٌّ دقيقٌ بحسابٍ صحيح (0.01 · 0.99 · 1.00 · 123.45)")
      : fail(`تحويلٌ خاطئ: ${badDecimal[0]} ⇒ ${halalasToDecimal(badDecimal[0])}`);

    const qr = buildQrTlv({
      seller_name: "متجر زادم",
      vat_number: GATE_VAT,
      timestamp: "2026-09-01T10:00:00Z",
      total_halalas: 32545,
      vat_halalas: 4245,
    });
    const parsed = parseQrTlv(qr);
    parsed[1] === "متجر زادم" &&
    parsed[2] === GATE_VAT &&
    parsed[3] === "2026-09-01T10:00:00Z" &&
    parsed[4] === "325.45" &&
    parsed[5] === "42.45"
      ? pass("الرمزُ يُبنى ويُفكّ حقلاً حقلاً — خمسةُ أوسمةٍ بقيمها")
      : fail(`فكُّ الرمز: ${JSON.stringify(parsed)}`);

    // بايتُ الطول واحد: ما يتجاوز ٢٥٥ بايتاً يُرفع لا يُقصّ
    let tooLong = false;
    try {
      buildQrTlv({
        seller_name: "م".repeat(200), // ٤٠٠ بايتٍ في UTF-8
        vat_number: GATE_VAT,
        timestamp: "2026-09-01T10:00:00Z",
        total_halalas: 100,
        vat_halalas: 15,
      });
    } catch {
      tooLong = true;
    }
    tooLong
      ? pass("**واسمٌ يتجاوز ٢٥٥ بايتاً يُرفع** — والقصُّ ينتج رمزاً لا يطابق الفاتورة")
      : fail("قُصَّ الاسمُ صامتاً");

    // ── ٦) ZATCA — الإصدارُ والسلسلة ────────────────────────────
    logger.info("== ZATCA: السلسلة ==");

    const sampleLines = [
      {
        description: "بند فحص",
        quantity: 1,
        unit_price: 10000,
        vat_rate: 15,
        line_total: 11500,
        vat_amount: 1500,
      },
    ];

    // ⚠️ **والمقعدُ قد يكون مشغولاً قبلنا** — نفسُ درسِ سياسة COD أعلاه.
    //
    // هذا الشاهدُ يقول «بلا إعداداتٍ لا تُصدَر فاتورة»، وهو يفترض قاعدةً
    // بلا صفِّ إعدادات. وCI يبدأ بقاعدةٍ جديدةٍ فلا يراه أبداً — أمّا
    // قاعدةُ مطوّرٍ (أو إنتاجٍ) فيها إعداداتٌ مضبوطةٌ فيسقط عندها الشاهدُ
    // **لأن النظام يعمل**، لا لأنه معطوب. وفاحصٌ يسقط على الحال السليمة
    // يُعلَّم القارئُ تجاهلَه.
    //
    // فتُخفى الإعداداتُ القائمةُ بحذفٍ ليّنٍ **وتُعاد في `finally`** — ولا
    // تُحذف حذفاً باتّاً: قد تكون إعداداتِ متجرٍ حقيقيّ.
    const liveSettings = await pg("zadim.zadim_zatca_setting")
      .whereNull("deleted_at")
      .select("id");
    const liveSettingIds = (liveSettings as any[]).map((r) => r.id);
    if (liveSettingIds.length) {
      await pg("zadim.zadim_zatca_setting")
        .whereIn("id", liveSettingIds)
        .update({ deleted_at: new Date() });
      restoreSettings.push(...liveSettingIds);
    }

    const beforeConfig = await zatca.issue({
      order_id: `ord_${tag}_x`,
      currency_code: "sar",
      total: 11500,
      vat_total: 1500,
      lines: sampleLines,
    });
    !beforeConfig.issued && beforeConfig.code === "ZATCA_NOT_CONFIGURED"
      ? pass("بلا إعداداتٍ **لا تُصدَر فاتورة** — ولا يُملأ الفراغُ برقمٍ وهميّ")
      : fail(`المتوقّع ZATCA_NOT_CONFIGURED: ${JSON.stringify(beforeConfig)}`);

    const [setting] = await zatca.createZatcaSettings([
      {
        seller_name: `متجر فحص البوّابة ${tag}`,
        vat_number: GATE_VAT,
        address_city: "الرياض",
        is_enabled: true,
      },
    ]);
    madeSettings.push(setting.id);

    // إصدارٌ متزامن: التسلسلُ لا يُترك للتزاحم
    const N = 15;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        zatca.issue({
          order_id: `ord_${tag}_${i}`,
          currency_code: "sar",
          total: 11500 + i,
          vat_total: 1500,
          lines: sampleLines,
        })
      )
    );
    madeOrders.push(...Array.from({ length: N }, (_, i) => `ord_${tag}_${i}`));

    const issued = results.filter((r) => r.issued) as any[];
    issued.length === N
      ? pass(`${N} فاتورةً متزامنةً صدرت كلُّها`)
      : fail(`صدرت ${issued.length} من ${N}`);

    const seqs = issued.map((r) => Number(r.invoice.sequence)).sort((a, b) => a - b);
    const contiguous = seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1);
    contiguous && new Set(seqs).size === N
      ? pass(`**التسلسلُ متّصلٌ بلا فجوةٍ ولا تكرار** (${seqs[0]}…${seqs[seqs.length - 1]})`)
      : fail(`التسلسل: ${seqs.join(",")}`);

    const chain = await zatca.verify();
    chain.ok
      ? pass(`السلسلةُ **كاملةً** تُعاد حسابُها وتطابق (${chain.count} فاتورة)`)
      : fail(`السلسلة مكسورةٌ عند ${chain.broken_at}: ${chain.reason}`);

    const first = await pg("zadim.zadim_zatca_invoice").where({ sequence: 1 }).first();
    first && first.previous_hash === genesisHash()
      ? pass("والأولى تشير إلى تجزئة البداية المحسوبة لا إلى ثابتٍ منسوخ")
      : fail(`تجزئةُ الأولى: ${first?.previous_hash}`);

    const dupIssue = await zatca.issue({
      order_id: `ord_${tag}_0`,
      currency_code: "sar",
      total: 11500,
      vat_total: 1500,
      lines: sampleLines,
    });
    !dupIssue.issued && dupIssue.code === "ALREADY_ISSUED"
      ? pass("وطلبٌ له فاتورةٌ لا تُصدَر له ثانية")
      : fail(`تكرارُ الإصدار: ${JSON.stringify(dupIssue)}`);

    // ── ٧) ZATCA — ما لا يمرّ ───────────────────────────────────
    logger.info("== ZATCA: ما لا يمرّ ==");

    const last = await pg("zadim.zadim_zatca_invoice").orderBy("sequence", "desc").first();

    let gapBlocked = false;
    try {
      await pg("zadim.zadim_zatca_invoice").insert({
        id: `zinv_gap_${tag}`,
        sequence: Number(last.sequence) + 2,
        uuid: `uuid-gap-${tag}`,
        order_id: `ord_gap_${tag}`,
        issued_at: new Date(),
        currency_code: "sar",
        total: 100,
        vat_total: 15,
        payload: JSON.stringify({}),
        previous_hash: last.invoice_hash,
        invoice_hash: "x",
        qr_base64: "x",
      });
    } catch {
      gapBlocked = true;
    }
    gapBlocked ? pass("فجوةٌ في التسلسل تُرفض") : fail("مرّت فجوة");

    let linkBlocked = false;
    try {
      await pg("zadim.zadim_zatca_invoice").insert({
        id: `zinv_bad_${tag}`,
        sequence: Number(last.sequence) + 1,
        uuid: `uuid-bad-${tag}`,
        order_id: `ord_bad_${tag}`,
        issued_at: new Date(),
        currency_code: "sar",
        total: 100,
        vat_total: 15,
        payload: JSON.stringify({}),
        previous_hash: "تجزئةٌ مختلقة",
        invoice_hash: "x",
        qr_base64: "x",
      });
    } catch {
      linkBlocked = true;
    }
    linkBlocked ? pass("وتجزئةٌ لا تشير إلى ما قبلها تُرفض") : fail("مرّت حلقةٌ منفصلة");

    let tamperBlocked = false;
    try {
      await pg("zadim.zadim_zatca_invoice")
        .where({ id: last.id })
        .update({ total: 999999 });
    } catch {
      tamperBlocked = true;
    }
    tamperBlocked ? pass("وفاتورةٌ صادرة لا تُعدَّل") : fail("عُدِّلت فاتورةٌ صادرة");

    await pg("zadim.zadim_zatca_invoice").where({ id: last.id }).del();
    (await pg("zadim.zadim_zatca_invoice").where({ id: last.id }).first())
      ? pass("ولا تُحذف — والفجوةُ تُفسَّر للهيئة")
      : fail("حُذفت فاتورة");

    await zatca.recordReporting(last.id, "reported", "ref-gate");
    const reported = await pg("zadim.zadim_zatca_invoice").where({ id: last.id }).first();
    reported.status === "reported" && reported.provider_ref === "ref-gate"
      ? pass("وحالُ الإبلاغ وحدَه يتغيّر بعد الإصدار")
      : fail(`حالُ الإبلاغ: ${reported?.status}`);
  } finally {
    for (const [table, id] of madeMoney) {
      await pg(`zadim.${table}`).where({ id }).del();
    }
    await pg("zadim.order_fulfillment").whereIn("fulfillment_id", madeFulfilments).del();
    await pg("zadim.fulfillment").whereIn("id", madeFulfilments).del();
    await pg("zadim.zadim_cod_policy").whereIn("id", madePolicies).del();
    // ثم يُعاد شاغلُ المقعد — **بعد** حذف صفوفنا، وإلا اصطدم بالفهرس
    // وهو يعود فبقيت القاعدةُ بلا سياسةٍ أصلاً.
    if (restoreEnabled.length) {
      await pg("zadim.zadim_cod_policy").whereIn("id", restoreEnabled).update({ deleted_at: null });
    }
    await pg("zadim.zadim_zatca_setting").whereIn("id", madeSettings).del();
    // ثم تُعاد إعداداتُ المتجر — **بعد** حذف إعداداتنا، تماماً كسياسة COD.
    if (restoreSettings.length) {
      await pg("zadim.zadim_zatca_setting")
        .whereIn("id", restoreSettings)
        .update({ deleted_at: null });
    }
    // الرفضاتُ والفواتيرُ والعملياتُ تبقى: قواعدُ «لا حذف» تُسقط حذفَها
    // بصمت، وهو المطلوب منها. **وسلسلةُ الفواتير تنمو ولا تُقصّ** —
    // فذاك ما يعنيه أن تكون سلسلة.
  }

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص المدفوعات.`);
  logger.info("✅ كلُّ فحوص المرحلة ٦ اجتازت — التحصيلُ بعد الشحن، والسلسلةُ متّصلة.");
}
