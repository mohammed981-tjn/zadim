import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { readiness } from "../modules/health/readiness";

/**
 * بوّابةُ الجهوزيّة — **وتنقض نفسَها قبل أن تصدّق نفسَها.**
 *
 * ── لماذا لا تكفي المناداةُ باليد ─────────────────────────────────
 *
 * فحصٌ لا يسقط حين يجب لا يحرس شيئاً. وقد كلّف هذا المستودعَ ثمناً
 * مقيساً: بوّاباتٌ خضراءُ على عطبٍ لأنها نادت الدالّةَ في الحالة
 * السعيدة وحدَها. فهذه البوّابةُ تكسر كلَّ فحصٍ على **قاعدةٍ حقيقيّة**
 * وتتأكّد أنه يسقط، ثم تُعيد الحالَ كما كانت.
 *
 * والكسرُ داخلَ معاملةٍ تُلغى (`rollback`) حيثما أمكن، فلا تبقى القاعدةُ
 * مكسورةً إن سقطت البوّابةُ في منتصفها.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-ready.ts
 */

type Fail = { what: string; why: string };

export default async function verifyReady({ container }: ExecArgs) {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const schema = process.env.DATABASE_SCHEMA || "zadim";
  const fails: Fail[] = [];
  const pass = (s: string) => console.log(`  ✔ ${s}`);
  const fail = (what: string, why: string) => {
    fails.push({ what, why });
    console.log(`  ✘ ${what} — ${why}`);
  };

  console.log("① الشاهدُ الموجب: قاعدةٌ مهاجَرةٌ مبذورة");
  const base = await readiness(pg, schema);
  if (base.ok) pass("جهوزيّةٌ كاملة، وخمسةُ فحوصٍ خضراء.");
  else
    fail(
      "الشاهدُ الموجب",
      `القاعدةُ يجب أن تكون جاهزةً هنا: ${JSON.stringify(base.checks)}`
    );

  // ── النقض: كلُّ فحصٍ يُكسر وحدَه ليُنسب السقوطُ إليه لا إلى غيره ──

  console.log("② نقضُ فحصِ المخطَّط");
  {
    const r = await readiness(pg, "schema_la_wujuda_lah");
    if (!r.ok && r.checks.schema?.ok === false) pass("مخطَّطٌ لا وجودَ له ⇒ سقط.");
    else fail("نقضُ المخطَّط", "لم يسقط على مخطَّطٍ غيرِ موجود.");
  }

  console.log("③ نقضُ فحصِ اسم المخطَّط");
  {
    const r = await readiness(pg, "zadim; drop table x");
    if (!r.ok && r.checks.schema_name?.ok === false) pass("اسمٌ غيرُ صالح ⇒ رُفض قبل أيّ استعلام.");
    else fail("نقضُ اسم المخطَّط", "قبِل اسماً غيرَ صالح.");
  }

  console.log("④ نقضُ فحصِ انقسام العائلتين — الأهمّ");
  {
    // جدولُ وحداتنا يُخرَج من المخطَّط ثم يُعاد. والإخراجُ بإعادة تسمية
    // لا بحذف: لا بياناتٍ تُمسّ، والعودةُ سطرٌ واحد.
    await pg.raw(`alter table "${schema}".zadim_audit_log rename to zadim_audit_log__probe`);
    try {
      const r = await readiness(pg, schema);
      if (!r.ok && r.checks.migrations?.ok === false) {
        pass(`سقط: ${r.checks.migrations.detail_ar}`);
        if (r.next_ar.some((s) => s.includes("search_path"))) pass("ويقول العلاجَ: search_path.");
        else fail("رسالةُ العلاج", "سقط بلا أن يذكر search_path — والرسالةُ نصفُ الفائدة.");
      } else {
        fail("نقضُ الانقسام", "لم يسقط وجداولُ وحداتنا خارجَ المخطَّط.");
      }
    } finally {
      await pg.raw(`alter table "${schema}".zadim_audit_log__probe rename to zadim_audit_log`);
    }
  }

  console.log("⑤ نقضُ فحصِ مفتاح النشر");
  {
    const trx = await pg.transaction();
    try {
      await trx.raw(
        `update "${schema}".api_key set revoked_at = now()
          where type = 'publishable' and revoked_at is null`
      );
      const r = await readiness(trx as any, schema);
      if (!r.ok && r.checks.publishable_key?.ok === false) pass("مفتاحٌ مُبطَلٌ ⇒ سقط.");
      else fail("نقضُ المفتاح", "لم يسقط ولا مفتاحَ صالحاً.");
    } finally {
      await trx.rollback();
    }
  }

  console.log("⑥ نقضُ فحصِ الكتالوج");
  {
    const trx = await pg.transaction();
    try {
      await trx.raw(`update "${schema}".product set deleted_at = now() where deleted_at is null`);
      const r = await readiness(trx as any, schema);
      if (!r.ok && r.checks.catalog?.ok === false) pass("كتالوجٌ فارغٌ ⇒ سقط.");
      else fail("نقضُ الكتالوج", "لم يسقط ولا منتجَ في الكتالوج.");
    } finally {
      await trx.rollback();
    }
  }

  console.log("⑦ القاعدةُ عادت كما كانت");
  {
    const after = await readiness(pg, schema);
    if (after.ok) pass("جهوزيّةٌ كاملةٌ بعد كلّ نقض — لا أثرَ باقٍ.");
    else fail("العودة", `القاعدةُ لم تعُد: ${JSON.stringify(after.checks)}`);
  }

  if (fails.length) {
    console.error(`\n✘ بوّابةُ الجهوزيّة سقطت في ${fails.length} موضعاً.`);
    for (const f of fails) console.error(`  · ${f.what}: ${f.why}`);
    process.exit(1);
  }
  console.log("\n✅ بوّابةُ الجهوزيّة: الشاهدُ الموجبُ وستّةُ نقوضٍ.");
}
