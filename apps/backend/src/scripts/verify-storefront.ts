import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { CMS_MODULE } from "../modules/cms";
import type CmsModuleService from "../modules/cms/service";

/**
 * بوّابةُ المرحلة ٩ — واجهةُ العميل (`07-roadmap.md`).
 *
 * > **ترتيبُ الرئيسية يتغيّر من اللوحة بلا نشرِ كود** · Lighthouse ≥ ٩٠
 * > على الجوال · RTL صحيحٌ في كل شاشة.
 *
 * ── وهذا الملفُّ يفحص الأوّل وحدَه ──────────────────────────────
 *
 * البندان الآخران يُقاسان على واجهةٍ تعمل في متصفّح، ولا يُقاسان هنا.
 * ومكتوبٌ صراحةً كي لا يُظنَّ أن خضرةَ هذه البوّابة تعني أن الواجهةَ
 * سريعةٌ وصحيحةُ الاتجاه — **لا تعني ذلك**.
 *
 * ── و«بلا نشرِ كود» تُؤخذ حرفياً ───────────────────────────────
 *
 * لا يُقارن ترتيبٌ بترتيب. **يُقرأ ما يراه العميل، ثم يُعاد الترتيبُ
 * بنداءٍ واحد، ثم يُقرأ ثانيةً** — على نفس العملية، بلا بناءٍ ولا
 * إقلاع. فإن تغيّر ما يراه العميل فقد تحقّق الشرط، وإلا فلا.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-storefront.ts
 */

export default async function verifyStorefront({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const cms = container.resolve(CMS_MODULE) as CmsModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const page = `gate-${Date.now()}`;
  const made: string[] = [];

  try {
    // ── ١) صفحةٌ بلا كتل ────────────────────────────────────────
    logger.info("== صفحةٌ لم تُضبط ==");

    const empty = await cms.blocksFor(page);
    empty.length === 0
      ? pass("صفحةٌ بلا كتلٍ تُعيد فراغاً — حالةٌ صريحةٌ لا انهيار")
      : fail(`أعادت ${empty.length} كتلة`);

    // ── ٢) الترتيبُ كما ضُبط ────────────────────────────────────
    logger.info("== الترتيب ==");

    const spec = [
      { type: "hero", name_ar: "الواجهة", position: 10 },
      { type: "product_grid", name_ar: "الأكثر مبيعاً", position: 20 },
      { type: "banner", name_ar: "لافتة الموسم", position: 30 },
    ];
    const created = await cms.createPageBlocks(
      spec.map((s) => ({ ...s, page, is_active: true, payload: { title: s.name_ar } }))
    );
    made.push(...(created as any[]).map((b) => b.id));

    const asStore = async () =>
      ((await cms.blocksFor(page)) as any[]).map((b) => b.type).join(" ⇐ ");

    const before = await asStore();
    before === "hero ⇐ product_grid ⇐ banner"
      ? pass(`ما يراه العميل: ${before}`)
      : fail(`الترتيبُ الأوّل: ${before}`);

    // ── ٣) 🔴 البوّابة: يتغيّر بنداءٍ واحد ──────────────────────
    logger.info("== إعادةُ الترتيب من اللوحة ==");

    const ids = (created as any[]).map((b) => b.id);
    // اللافتةُ إلى الأعلى، والواجهةُ إلى الأسفل — كما يفعل المديرُ في
    // موسم التخفيضات.
    await cms.reorder(page, [ids[2], ids[1], ids[0]]);

    const after = await asStore();
    after === "banner ⇐ product_grid ⇐ hero"
      ? pass(`وبعد نداءٍ واحد: ${after}`)
      : fail(`لم يتغيّر الترتيب: ${after}`);

    after !== before
      ? pass("**فما يراه العميلُ تغيّر — بلا بناءٍ ولا نشرٍ ولا إقلاع**")
      : fail("الترتيبُ لم يتغيّر أصلاً");

    // ── ٤) الترقيمُ بعشرات ─────────────────────────────────────
    const positions = ((await cms.blocksFor(page)) as any[]).map((b) => Number(b.position));
    positions.join(",") === "10,20,30"
      ? pass("والترقيمُ بعشراتٍ لا آحاد — تُدخَل كتلةٌ بين اثنتين بلا إعادةِ ترقيم")
      : fail(`المواضع: ${positions.join(",")}`);

    // ── ٥) الحسمُ عند التعادل ──────────────────────────────────
    logger.info("== الحسمُ عند التعادل ==");

    const tied = await cms.createPageBlocks([
      { page, type: "rich_text", position: 20, is_active: true, payload: {} },
    ]);
    made.push(...(tied as any[]).map((b) => b.id));

    const a = ((await cms.blocksFor(page)) as any[]).map((b) => b.id).join(",");
    const b2 = ((await cms.blocksFor(page)) as any[]).map((b) => b.id).join(",");
    a === b2
      ? pass("كتلتان بنفس الموضع ⇒ ترتيبٌ ثابتٌ بين قراءتين (المعرّفُ يحسم)")
      : fail("الترتيبُ يتبدّل بين قراءتين — والمديرُ يرى صفحتَه تتغيّر بلا سبب");

    // ── ٦) المخفيُّ يختفي عن العميل ولا يختفي عن المدير ────────
    logger.info("== الإخفاء ==");

    await cms.updatePageBlocks({ id: ids[1], is_active: false });

    const storeTypes = ((await cms.blocksFor(page)) as any[]).map((b) => b.id);
    const adminTypes = ((await cms.listPageBlocks({ page })) as any[]).map((b) => b.id);

    !storeTypes.includes(ids[1]) && adminTypes.includes(ids[1])
      ? pass("كتلةٌ أُطفئت تختفي عن العميل **وتبقى في اللوحة** — وإلا تعذّر إشعالُها")
      : fail("الإخفاءُ يخفيها عن الاثنين أو عن لا أحد");

    // ── ٧) نوعٌ لا تعرفه الواجهة ───────────────────────────────
    const future = await cms.createPageBlocks([
      { page, type: "block_type_from_the_future", position: 5, is_active: true, payload: { x: 1 } },
    ]);
    made.push(...(future as any[]).map((b) => b.id));

    const withFuture = (await cms.blocksFor(page)) as any[];
    withFuture[0]?.type === "block_type_from_the_future"
      ? pass("ونوعٌ لا تعرفه الواجهةُ يمرّ في الردّ — تتجاهله هي ولا تنهار")
      : fail("النوعُ الجديد لم يُعَد");

    // ── ٨) الجديدةُ تنزل آخرَ الصفحة ───────────────────────────
    logger.info("== الإضافة ==");

    const existing = (await cms.listPageBlocks({ page })) as any[];
    const last = existing.reduce((m, b) => Math.max(m, Number(b.position)), 0);
    const appended = await cms.createPageBlocks([
      { page, type: "banner", position: last + 10, is_active: true, payload: {} },
    ]);
    made.push(...(appended as any[]).map((b) => b.id));

    const order = ((await cms.blocksFor(page)) as any[]).map((b) => b.id);
    order[order.length - 1] === (appended as any[])[0].id
      ? pass("كتلةٌ جديدةٌ تنزل آخرَ الصفحة — لا تُقحَم في أعلى متجرٍ حيّ")
      : fail("الجديدةُ ظهرت في غير آخرِ الصفحة");

    // ── ٩) معرّفٌ غريبٌ يُرفض ──────────────────────────────────
    let rejected = false;
    try {
      await cms.reorder(page, ["blk_la_yujad"]);
    } catch {
      rejected = true;
    }
    rejected
      ? pass("وإعادةُ ترتيبٍ بمعرّفٍ ليس في الصفحة تُرفض")
      : fail("قُبل معرّفٌ غريب");
  } finally {
    await pg("zadim.zadim_page_block").whereIn("id", made).del();
  }

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص الواجهة.`);
  logger.info(
    "✅ فحوصُ ترتيب الرئيسية اجتازت — والسرعةُ والاتجاهُ يُقاسان على واجهةٍ تعمل، لا هنا."
  );
}
