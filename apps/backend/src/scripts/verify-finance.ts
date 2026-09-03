import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { FINANCE_MODULE } from "../modules/finance";
import type FinanceModuleService from "../modules/finance/service";
import { MARKETPLACE_MODULE } from "../modules/marketplace";
import type MarketplaceModuleService from "../modules/marketplace/service";

/**
 * بوّابةُ «**ما لا يُؤجَّل**» — التكلفةُ المجمَّدة و`vendor_id`.
 *
 * البندان كلاهما في جدول «ما لا يُؤجَّل مهما ضاق الوقت» في
 * `07-roadmap.md`، وكلاهما قِيس **غائباً** عن القاعدة الحيّة في
 * 2026-09-03. وهذه البوّابةُ تمنع غيابَهما ثانيةً.
 *
 * ⚠️ **وأخطرُ ما تحرسه ليس الوجودَ بل الجمود**: عمودٌ اسمُه `unit_cost`
 * يُكتب مرّتين ليس تكلفةً مجمَّدة — هو حقلٌ عاديٌّ باسمٍ يَعِد بما لا
 * يفي به. فلكلّ فحصٍ هنا **شاهدٌ سالب**: تُجرَّب المخالفةُ ويُتأكَّد
 * أنها تُرفض.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-finance.ts
 */
export default async function verifyFinance({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const finance = container.resolve(FINANCE_MODULE) as FinanceModuleService;
  const market = container.resolve(MARKETPLACE_MODULE) as MarketplaceModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `vfin-${Date.now()}`;
  const variantId = `var_${tag}`;

  try {
    // ── ١) الأعمدةُ موجودة ──────────────────────────────────────
    logger.info("== الأعمدةُ التي لا يُؤجَّل وجودُها ==");

    const cols = await pg.raw(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = current_schema()
          and column_name in ('unit_cost','unit_cost_source','vendor_id')`
    );
    const have = new Set(
      (cols?.rows ?? []).map((r: any) => `${r.table_name}.${r.column_name}`)
    );

    have.has("order_line_item.unit_cost")
      ? pass("`order_line_item.unit_cost` موجود — «ربحُ الماضي لا يُحسب بتكلفة اليوم»")
      : fail("لا عمودَ `unit_cost` على `order_line_item`");

    for (const t of ["product", "order", "order_line_item", "inventory_item"]) {
      have.has(`${t}.vendor_id`)
        ? pass(`\`${t}.vendor_id\` موجودٌ ومعطَّل`)
        : fail(`لا \`vendor_id\` على \`${t}\` — وإضافتُه على جدولٍ يبيع قفلٌ توقف عنده المبيعات`);
    }

    // ── ٢) السجلُّ: صفٌّ نافذٌ واحد، والسابقُ يُغلق وحدَه ────────
    logger.info("== سجلُّ التكلفة ==");

    await finance.recordCost({ variant_id: variantId, unit_cost: 2000, source: "gate" });
    (await finance.currentCost(variantId)) === 2000
      ? pass("التكلفةُ النافذة تُقرأ (٢٠٠٠ هللة)")
      : fail("التكلفةُ النافذة لا تُقرأ بعد تسجيلها");

    await finance.recordCost({ variant_id: variantId, unit_cost: 2400, source: "gate" });
    (await finance.currentCost(variantId)) === 2400
      ? pass("وتسجيلٌ ثانٍ يصير هو النافذ")
      : fail("التسجيلُ الثاني لم يصر النافذ");

    const open = await pg.raw(
      `select count(*)::int as n from "zadim_variant_cost"
        where "variant_id" = ? and "effective_to" is null and "deleted_at" is null`,
      [variantId]
    );
    Number(open?.rows?.[0]?.n) === 1
      ? pass("والسابقُ أُغلق وحدَه — صفٌّ نافذٌ واحدٌ لا اثنان")
      : fail(`صفوفٌ نافذةٌ: ${open?.rows?.[0]?.n} — «التكلفةُ الحاليّة» صار سؤالاً بجوابين`);

    const history = await pg.raw(
      `select count(*)::int as n from "zadim_variant_cost" where "variant_id" = ?`,
      [variantId]
    );
    Number(history?.rows?.[0]?.n) === 2
      ? pass("والتاريخُ باقٍ — التسجيلُ الجديد صفٌّ لا تحديثٌ يمحو")
      : fail("التاريخُ ضاع: التسجيلُ الجديد محا القديم");

    // شاهدٌ سالب: بالهللات صحيحةً وغيرِ سالبة.
    let rejected = false;
    try {
      await finance.recordCost({ variant_id: variantId, unit_cost: -1 });
    } catch {
      rejected = true;
    }
    rejected
      ? pass("وشاهدُه السالب: تكلفةٌ سالبةٌ تُرفض")
      : fail("تكلفةٌ سالبةٌ قُبلت — وهي خطأُ إدخالٍ لا تكلفة");

    rejected = false;
    try {
      await finance.recordCost({ variant_id: variantId, unit_cost: 19.99 as number });
    } catch {
      rejected = true;
    }
    rejected
      ? pass("وكسرٌ عشريٌّ يُرفض — «١٩٫٩٩» هنا تسعَ عشرةَ هللةً لا تسعةَ عشرَ ريالاً (ADR-008)")
      : fail("كسرٌ عشريٌّ قُبل في حقلٍ بالهللات");

    // ── ٣) التجميدُ عند الإدراج ─────────────────────────────────
    logger.info("== التجميد ==");

    // سطرٌ خامٌ مباشرةً على الجدول: نفحص المُطلِقَ لا سيرَ العمل، لأن
    // المُطلِقَ هو ما يمرّ به **كلُّ** كاتبٍ بما فيهم من لم يُكتب بعد.
    const lineId = `oli_${tag}`;
    await pg.raw(
      `insert into "order_line_item"
         ("id","title","variant_id","unit_price","raw_unit_price","created_at","updated_at")
       values (?, 'بوّابة', ?, 5000, '{"value":"5000","precision":20}'::jsonb, now(), now())`,
      [lineId, variantId]
    );
    const frozen = await pg.raw(
      `select "unit_cost", "unit_cost_source" from "order_line_item" where "id" = ?`,
      [lineId]
    );
    const row = frozen?.rows?.[0];
    Number(row?.unit_cost) === 2400
      ? pass("سطرُ طلبٍ جديدٌ يحمل التكلفةَ النافذة مجمَّدةً (٢٤٠٠)")
      : fail(`unit_cost على السطر: ${row?.unit_cost} — التجميدُ لم يقع`);
    row?.unit_cost_source === "gate"
      ? pass("ومعها مصدرُها — «من أين جاء هذا الرقم» سؤالٌ له جواب")
      : fail(`المصدرُ: ${row?.unit_cost_source}`);

    // ── ٤) 🔴 والمجمَّدُ لا يُكتب مرّتين ────────────────────────
    await finance.recordCost({ variant_id: variantId, unit_cost: 9999, source: "gate" });
    const after = await pg.raw(
      `select "unit_cost" from "order_line_item" where "id" = ?`,
      [lineId]
    );
    Number(after?.rows?.[0]?.unit_cost) === 2400
      ? pass("وتغيُّرُ التكلفة اليوم **لا يمسّ** سطرَ الأمس — وهذا كلُّ معنى «مجمَّدة»")
      : fail("ربحُ الماضي تغيّر بتكلفة اليوم");

    let refused = false;
    try {
      await pg.raw(`update "order_line_item" set "unit_cost" = 1 where "id" = ?`, [lineId]);
    } catch {
      refused = true;
    }
    refused
      ? pass("وشاهدُه السالب: `update` مباشرٌ على `unit_cost` يُرفض في القاعدة")
      : fail("`unit_cost` قابلةٌ للتغيير — فـ«مجمَّدة» نيّةٌ يكسرها أوّلُ تصحيح");

    // وسطرٌ لمتغيّرٍ بلا تكلفةٍ مسجَّلة يمرّ بـ`null` ولا يُرفض.
    const orphan = `oli_${tag}_x`;
    await pg.raw(
      `insert into "order_line_item"
         ("id","title","variant_id","unit_price","raw_unit_price","created_at","updated_at")
       values (?, 'بلا تكلفة', ?, 5000, '{"value":"5000","precision":20}'::jsonb, now(), now())`,
      [orphan, `var_unknown_${tag}`]
    );
    const nullRow = await pg.raw(
      `select "unit_cost" from "order_line_item" where "id" = ?`,
      [orphan]
    );
    nullRow?.rows?.[0]?.unit_cost === null
      ? pass("ومتغيّرٌ بلا تكلفةٍ مسجَّلة ⇒ `null` لا صفر — «لا نعرف» تخرج من الحساب و«صفر» ترفع الهامشَ إلى ١٠٠٪")
      : fail(`المتوقّع null: ${nullRow?.rows?.[0]?.unit_cost}`);

    // ── ٥) السوق: موجودٌ ومعطَّل ────────────────────────────────
    logger.info("== السوق (معطَّل) ==");

    const vendorRows = await pg.raw(`select count(*)::int as n from "zadim_vendor"`);
    Number(vendorRows?.rows?.[0]?.n) === 0
      ? pass("ولا بائعَ مبذور — «بائعٌ اسمه زادم» يجعل الحقلَ ممتلئاً بما لا معنى له فيُظنّ أن الميزةَ تعمل")
      : fail("ثمّةَ بائعٌ مبذورٌ في قاعدةٍ لم يُفتح فيها السوق");

    const created = await market.createVendors({
      name: `بائع ${tag}`,
      handle: `v-${tag}`,
      commission_bps: 500,
    } as any);
    const vendorId = (Array.isArray(created) ? created[0] : created)?.id;

    const v = await market.byHandle(`v-${tag}`);
    (v as any)?.is_active === false
      ? pass("وبائعٌ يُنشأ **غيرَ مفعَّل** — يُنشأ لا يبيع حتى يُعتمد")
      : fail("بائعٌ جديدٌ مفعَّلٌ افتراضاً");

    (await market.activeVendors()).length === 0
      ? pass("و«المعتمدون» لا تشمله")
      : fail("بائعٌ غيرُ معتمدٍ يظهر في المعتمدين");

    if (vendorId) await market.deleteVendors(vendorId);

    // شاهدٌ سالب على العمولة.
    refused = false;
    try {
      await pg.raw(
        `insert into "zadim_vendor" ("id","name","handle","commission_bps","created_at","updated_at")
         values (?, 'خارج المدى', ?, 10001, now(), now())`,
        [`vend_${tag}_bad`, `bad-${tag}`]
      );
    } catch {
      refused = true;
    }
    refused
      ? pass("وعمولةٌ فوق ١٠٠٪ تُرفض — ليست خصماً بل خطأَ إدخالٍ يأكل ثمنَ البضاعة")
      : fail("عمولةٌ فوق ١٠٠٪ قُبلت");
  } finally {
    await pg.raw(`delete from "order_line_item" where "id" like ?`, [`oli_${tag}%`]);
    await pg.raw(`delete from "zadim_variant_cost" where "variant_id" like ?`, [`var_%${tag}%`]);
    await pg.raw(`delete from "zadim_vendor" where "handle" like ?`, [`%${tag}%`]);
  }

  if (failures > 0) {
    logger.error(`⛔ سقط ${failures} فحصاً.`);
    process.exit(1);
  }
  logger.info("✅ بوّابةُ «ما لا يُؤجَّل» اجتازت.");
}
