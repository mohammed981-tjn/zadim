import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { COUPON_POLICY_MODULE } from "../modules/promotions";
import { validate, capWarning } from "../api/admin/coupons/policies/route";
import type PromotionsPolicyService from "../modules/promotions/service";
import { checkCoupon, orderByPriority, DEFAULT_PRIORITY } from "../modules/promotions/eligibility";

/**
 * بوّابةُ الكوبونات والعروض (بندا ٢٦ و٢٧).
 *
 * ── ثلاثةُ مستوياتٍ، وكلٌّ يُفحص حيث يعيش ────────────────────────
 *
 * ١. **منطقٌ خالص** — الأهليّةُ بصفوفٍ مكتوبةٍ بخطّ اليد، بلا قاعدة.
 * ٢. **حرّاسُ القاعدة** — الحدُّ لكل عميلٍ ودفترُ الاستهلاك، بالنقض.
 * ٣. 🔴 **التزامن** — مئةُ استهلاكٍ متزامنٍ على كوبونٍ حدُّه واحد.
 *
 * والثالثُ هو البوّابةُ الحقيقية: «اقرأِ العدَّ ثم قرّر» صحيحٌ في كل
 * تشغيلةٍ منفردة وخاطئٌ في اثنتين معاً — وهو نصُّ `01-domain-model.md`
 * §٣: «وإلا مرّ ألفُ طلبٍ في ثانيةٍ واحدة على كوبونٍ حدُّه واحد».
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-coupons.ts
 */
export default async function verifyCoupons({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const promo: any = container.resolve(Modules.PROMOTION);
  const policies = container.resolve<PromotionsPolicyService>(COUPON_POLICY_MODULE);

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  // ── ١) المنطقُ الخالص — بلا قاعدة ─────────────────────────────
  logger.info("== الأهليّة: منطقٌ خالصٌ يُفحص بلا قاعدة ==");

  const base = { redemptions_by_customer: 0, previous_orders: 0, computed_discount: 500, is_guest: false };

  checkCoupon(null, base).ok
    ? pass("بلا سياسةٍ عندنا: يمرّ بحدود Medusa وحدَها — وغيابُ الصفّ ليس منعاً")
    : fail("سياسةٌ غائبةٌ مُنعت");

  const perCustomer = { per_customer_limit: 1, max_discount: null, first_order_only: false };
  const used = checkCoupon(perCustomer, { ...base, redemptions_by_customer: 1 });
  !used.ok && used.code === "PER_CUSTOMER_LIMIT"
    ? pass("من استعمله مرّةً وحدُّه واحدةٌ يُرفض")
    : fail(`الحدُّ لكل عميلٍ مرّ: ${JSON.stringify(used)}`);

  // 🔴 الضيفُ مع حدٍّ لكل عميل: لا هويّةَ يُعدّ عليها، فالحدُّ بلا معنى
  // — ويُعاد استعمالُ الكوبون بلا نهاية لو مرّ.
  const guest = checkCoupon(perCustomer, { ...base, is_guest: true });
  !guest.ok && guest.code === "SIGN_IN_REQUIRED"
    ? pass("وضيفٌ على كوبونٍ بحدٍّ لكل عميل يُرفض — لا هويّةَ تُعدّ عليها")
    : fail(`الضيفُ مرّ على كوبونٍ بحدّ: ${JSON.stringify(guest)}`);

  const firstOnly = { per_customer_limit: null, max_discount: null, first_order_only: true };
  const repeat = checkCoupon(firstOnly, { ...base, previous_orders: 3 });
  !repeat.ok && repeat.code === "FIRST_ORDER_ONLY"
    ? pass("و«أوّلُ طلبٍ فقط» يُرفض لمن له طلباتٌ سابقة")
    : fail(`أوّلُ طلبٍ مرّ لعميلٍ قديم: ${JSON.stringify(repeat)}`);
  checkCoupon(firstOnly, base).ok
    ? pass("ويمرّ لمن لا طلبَ له — والشاهدُ الموجب")
    : fail("أوّلُ طلبٍ رُفض لعميلٍ جديد");

  // 🔴 سقفُ الخصم — وهو ما لا يملكه المحرّك إطلاقاً.
  const capped = { per_customer_limit: null, max_discount: 10000, first_order_only: false };
  const over = checkCoupon(capped, { ...base, computed_discount: 10001 });
  !over.ok && over.code === "DISCOUNT_CAP"
    ? pass("وخصمٌ يتجاوز السقفَ بهللةٍ واحدةٍ يُرفض")
    : fail(`تجاوزُ السقف مرّ: ${JSON.stringify(over)}`);
  checkCoupon(capped, { ...base, computed_discount: 10000 }).ok
    ? pass("والمساوي للسقف يمرّ — الحدُّ حدٌّ لا أقلُّ منه")
    : fail("المساوي للسقف رُفض");

  // ── ٢) ترتيبُ التطبيق — رقمٌ لا سلوكٌ ضمنيّ ────────────────────
  logger.info("== ترتيبُ التطبيق: رقمٌ يضبطه المدير ==");

  const codes = [{ code: "B" }, { code: "A" }, { code: "C" }];
  const prio = new Map([["A", 300], ["B", 100]]);
  const sorted = orderByPriority(codes, (c) => prio.get(c));
  // B(100) ثم C(الافتراض 100 — ويبقى بعد B لأن الترتيبَ مستقرّ) ثم A(300)
  sorted.map((s) => s.code).join("") === "BCA"
    ? pass(`الأصغرُ أوّلاً والتعادلُ مستقرّ (${sorted.map((s) => s.code).join(" → ")})`)
    : fail(`الترتيبُ ${sorted.map((s) => s.code).join(" → ")} لا BCA`);
  DEFAULT_PRIORITY === 100
    ? pass("وما لا سياسةَ له يأخذ الافتراض")
    : fail("الافتراضُ تغيّر");

  // ── ٣) حرّاسُ القاعدة ──────────────────────────────────────────
  logger.info("== حرّاسُ القاعدة: الحدُّ لكل عميلٍ ودفترٌ لا يُمسّ ==");

  const tag = Date.now().toString(36).toUpperCase();
  const code = `GATE${tag}`;
  const [promotion] = (await promo.createPromotions([
    {
      code,
      is_automatic: false,
      type: "standard",
      status: "active",
      application_method: {
        type: "percentage",
        target_type: "items",
        allocation: "across",
        value: 10,
        currency_code: "sar",
      },
      rules: [],
    },
  ] as any)) as any[];

  await policies.createCouponPolicies({
    promotion_id: promotion.id,
    promotion_code: code,
    per_customer_limit: 1,
    max_discount: null,
    first_order_only: false,
    priority: 50,
  } as any);

  const customer = `cus_gate_${tag}`;

  // 🔴 البوّابة: مئةُ استهلاكٍ متزامنٍ على حدٍّ واحد ⇒ **واحدٌ بالضبط**.
  const ATTEMPTS = 100;
  const results = await Promise.allSettled(
    Array.from({ length: ATTEMPTS }, () =>
      policies.createCouponRedemptions({
        promotion_id: promotion.id,
        promotion_code: code,
        customer_id: customer,
      } as any)
    )
  );
  const okCount = results.filter((r) => r.status === "fulfilled").length;
  const firstError = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (okCount === 0 && firstError) {
    logger.error(`     ولا واحدةَ نجحت — سببُ الرفض: ${String(firstError.reason?.message ?? firstError.reason)}`);
  }
  const rows = await pg.raw(
    `select count(*)::int as n from "zadim"."zadim_coupon_redemption"
      where "promotion_id" = ? and "customer_id" = ?`,
    [promotion.id, customer]
  );
  const stored = Number(rows?.rows?.[0]?.n ?? 0);

  logger.info(`     ${ATTEMPTS} محاولةً متزامنة ⇒ نجح ${okCount} · وفي القاعدة ${stored}`);
  // ⚠️ ويُقاس بالقاعدة لا بعدّ النجاحات: مسارٌ يُعيد «تمّ» ويكتب صفّاً
  // ثانياً خلفه أسوأُ من رفضٍ صريح.
  stored === 1
    ? pass(`وفي القاعدة **صفٌّ واحدٌ بالضبط** رغم ${ATTEMPTS} محاولةً متزامنة`)
    : fail(`في القاعدة ${stored} صفّاً — الحدُّ انكسر تحت التزامن`);
  okCount === 1
    ? pass("ونجحت واحدةٌ فقط — والباقي رُفض صراحةً لا صامتاً")
    : fail(`نجح ${okCount} من ${ATTEMPTS} — والقاعدةُ فيها ${stored}`);

  // الدفترُ لا يُعدَّل ولا يُحذف
  const one = await pg.raw(
    `select "id","redemption_seq" from "zadim"."zadim_coupon_redemption"
      where "promotion_id" = ? and "customer_id" = ? limit 1`,
    [promotion.id, customer]
  );
  const rid = one?.rows?.[0]?.id;
  if (!rid) fail("لا صفَّ استهلاكٍ لفحص جمود الدفتر");
  if (rid) {
    await pg.raw(`update "zadim"."zadim_coupon_redemption" set "redemption_seq" = 99 where "id" = ?`, [rid]).catch(() => {});
  }
  const after = rid
    ? await pg.raw(`select "redemption_seq" from "zadim"."zadim_coupon_redemption" where "id" = ?`, [rid])
    : { rows: [] };
  Number(after?.rows?.[0]?.redemption_seq) === 1
    ? pass("ودفترُ الاستهلاك لا يُعدَّل")
    : fail(`تغيّر ترتيبُ الاستهلاك: ${JSON.stringify(after?.rows?.[0])}`);

  // وحدٌّ لعميلٍ آخر لا يتأثّر: الحدُّ **لكل عميل** لا كلّيّ.
  const other = await policies
    .createCouponRedemptions({
      promotion_id: promotion.id,
      promotion_code: code,
      customer_id: `cus_other_${tag}`,
    } as any)
    .then(() => true)
    .catch(() => false);
  other
    ? pass("وعميلٌ آخرُ يستعمله — فالحدُّ لكل عميلٍ لا كلّيّ")
    : fail("عميلٌ آخرُ مُنع — الحدُّ صار كلّياً");

  // ── 🔴 والسياسةُ صار يضبطها مسارٌ إداريّ ────────────────────
  //
  // وهذا كان الثقبَ: الجدولُ مبنيٌّ ومحروسٌ ومُختبَرٌ **ولا يكتبه أحد**
  // إلا `psql`. وهو نفسُ الصنف الذي بُني هذا التدقيقُ لكشفه — قدرةٌ
  // مكتملةٌ لا يناديها مسارُ إنتاجٍ واحد.
  logger.info("== وسياسةُ الكوبون صار يضبطها مسارٌ إداريّ ==");

  const { readFileSync, existsSync } = await import("fs");
  const routeFile = "src/api/admin/coupons/policies/route.ts";
  existsSync(routeFile) && /createCouponPolicies\(/.test(readFileSync(routeFile, "utf8"))
    ? pass("المسارُ الإداريُّ موجودٌ ويكتب السياسة — لا `psql` وحدَه")
    : fail("لا مسارَ إداريَّ يكتب `zadim_coupon_policy` — السياسةُ حبرٌ");

  // وخريطةُ الصلاحيات تعرفه: مسارٌ بلا قاعدةٍ يُرفض افتراضاً، فيبدو
  // «معطوباً» بينما هو **غيرُ مسجَّل**.
  const map = readFileSync("src/modules/access/permission-map.ts", "utf8");
  /coupons\\\/policies/.test(map)
    ? pass("وخريطةُ الصلاحيات تحرسه — لا يسقط في الرفض الافتراضيّ صامتاً")
    : fail("المسارُ ليس في `permission-map.ts` — سيُرفض بلا سببٍ مفهوم");

  // ── والتحقّقُ يردّ برسالةٍ ولا يقصّ بصمت ────────────────────
  //
  // ⚠️ ومديرٌ كتب صفراً يقصد «ممنوعٌ على الجميع»، وقصُّه إلى واحدٍ
  // يعطيه سلوكاً لم يطلبه ولا يعرف أنه وقع.
  const cases: Array<[string, any, boolean]> = [
    ["حدٌّ صفرٌ يُرفض (إطفاءٌ يُقال بالحالة لا برقمٍ يبدو حدّاً)", { per_customer_limit: 0 }, false],
    ["وحدٌّ سالبٌ يُرفض", { per_customer_limit: -1 }, false],
    ["وسقفٌ صفرٌ يُرفض", { max_discount: 0 }, false],
    ["وسقفٌ كسريٌّ يُرفض (الهللاتُ صحيحةٌ — ADR-008)", { max_discount: 19.99 }, false],
    ["وترتيبٌ خارجَ المدى يُرفض", { priority: 99999 }, false],
    ["و`null` تعني «بلا قيد» فتُقبل", { per_customer_limit: null, max_discount: null }, true],
    ["وقيمٌ سليمةٌ تُقبل", { per_customer_limit: 2, max_discount: 5000, priority: 10 }, true],
  ];
  let validOk = true;
  for (const [why, body, shouldPass] of cases) {
    const got = validate(body) === null;
    if (got !== shouldPass) {
      fail(`التحقّق: ${why} — النتيجة ${got} والمتوقَّع ${shouldPass}`);
      validOk = false;
    }
  }
  if (validOk) pass(`والتحقّقُ يطابق جدولَ الحقيقة (${cases.length} حالات)`);

  // ── 🔴 والسقفُ يقول ما يفعله — لا ما نتمنّاه ────────────────
  //
  // وهذا قِيس ولم يُظنّ: `updateCartPromotionsWorkflow` يحذف التسويّاتِ
  // ثمّ يُعيد بناءها من `computeActions`، فأيُّ قصٍّ بأيدينا يُمحى مع
  // أوّل تغيّرٍ في السلّة. فالسقفُ يعمل **بالرفض**، والمديرُ يُخبَر
  // بذلك **لحظةَ ضبطه** لا بعد شكوى عميل.
  const pct = { application_method: { type: "percentage" } };
  const fixed = { application_method: { type: "fixed" } };

  const warnCases: Array<[string, any, any, boolean]> = [
    ["سقفٌ على نسبةٍ ⇒ يُنبَّه أنه يرفض ولا يقصّ", { max_discount: 5000 }, pct, true],
    ["وسقفٌ على مبلغٍ ثابتٍ ⇒ لا تنبيه (السقفُ هو المبلغُ نفسُه)", { max_discount: 5000 }, fixed, false],
    ["ولا سقفَ ⇒ لا تنبيه", {}, pct, false],
    ["و`null` صريحةٌ ⇒ لا تنبيه", { max_discount: null }, pct, false],
  ];
  let warnOk = true;
  for (const [why, body, promo2, shouldWarn] of warnCases) {
    if ((capWarning(body, promo2) !== null) !== shouldWarn) {
      fail(`تنبيهُ السقف: ${why}`);
      warnOk = false;
    }
  }
  if (warnOk) {
    pass("وتنبيهُ السقف يُقال للنسبة وحدَها — والمبلغُ الثابتُ سقفُه هو مبلغُه");
  }

  if (failures) {
    throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الكوبونات.`);
  }
  logger.info("✅ بوّابةُ الكوبونات اجتازت — والحدُّ لكل عميلٍ صمد تحت مئة محاولةٍ متزامنة.");
}
