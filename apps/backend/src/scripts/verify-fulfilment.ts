import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { FULFILMENT_MODULE } from "../modules/fulfilment";
import type FulfilmentModuleService from "../modules/fulfilment/service";
import { assignWalkOrder, isComplete, scanBarcode } from "../modules/fulfilment/picking";
import { auditShippingRates, wouldFlag } from "../modules/fulfilment/rate-audit";
import { discoverCarriers } from "../modules/carriers/discover";

/**
 * بوّابةُ المرحلة ٧ — الشحن والتنفيذ (`07-roadmap.md`).
 *
 * > **صفرُ أجرةِ شحنٍ في الكود** (يُفحص في CI) · إضافةُ ناقلٍ ثانٍ
 * > **لا تعدّل ملفاً واحداً خارج مجلد المحوّلات** · مسحُ باركودٍ خاطئ
 * > **يوقف اللقط**.
 *
 * والبندُ الثاني يُفحص **حرفياً**: يُبحث عن اسم كل ناقلٍ في كل ملفٍّ
 * خارج مجلَّده. فالوعدُ «لا تعدّل ملفاً» لا يُثبته أنّا لم نعدّل، بل
 * أنّ الاسمَ **لا يوجد** حيث يجب ألّا يوجد.
 *
 * التشغيل: npx medusa exec ./src/scripts/verify-fulfilment.ts
 */

export default async function verifyFulfilment({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const ful = container.resolve(FULFILMENT_MODULE) as FulfilmentModuleService;

  let failures = 0;
  const pass = (m: string) => logger.info(`  ✅ ${m}`);
  const fail = (m: string) => {
    logger.error(`  ⛔ ${m}`);
    failures++;
  };

  const tag = `vful-${Date.now()}`;
  const madeLists: string[] = [];
  const madeParcels: string[] = [];

  try {
    // ── ١) صفرُ أجرةِ شحنٍ في الكود ──────────────────────────────
    logger.info("== صفرُ أجرةِ شحنٍ في الكود ==");

    // 🔴 الشاهدُ الموجب أوّلاً: فحصٌ أعمى يُعيد «صفراً» أيضاً.
    const traps = [
      `const shippingFee = 2500;`,
      `return { shipping_total: 1500 }`,
      `أجرةُ الشحن 25 ريالاً`,
    ];
    const trapped = traps.filter((t) => wouldFlag(t)).length;
    trapped === traps.length
      ? pass(`الفاحصُ يمسك أجرةً صريحةً في ${trapped} صورةٍ من ${traps.length}`)
      : fail(`الفاحصُ أعمى: أمسك ${trapped} من ${traps.length}`);

    const innocents = [
      `const limit = Math.min(Number(q.limit ?? 50), 500)`,
      `if (res.status === 404) return null`,
      `const shippingOption = await fulfillment.retrieve(id)`,
    ];
    const falsePositives = innocents.filter((t) => wouldFlag(t));
    falsePositives.length === 0
      ? pass("ولا يشتكي من سطورٍ بريئة")
      : fail(`بلاغاتٌ كاذبة: ${JSON.stringify(falsePositives)}`);

    const findings = auditShippingRates();
    findings.length === 0
      ? pass("**والكودُ الحيُّ خالٍ من أجرةِ شحنٍ مكتوبة** (src/modules · src/api)")
      : fail(
          `${findings.length} أجرةً في الكود: ${findings
            .slice(0, 3)
            .map((f) => `${f.file}:${f.line}`)
            .join(" · ")}`
        );

    // ── ٢) ناقلٌ ثانٍ بلا تعديلِ ملفٍّ خارج مجلَّده ─────────────
    logger.info("== المحوّلات ==");

    const carriers = discoverCarriers();
    carriers.length >= 2
      ? pass(`اكتُشف ${carriers.length} محوّلاً من المجلَّد: ${carriers.map((c) => c.id).join(" · ")}`)
      : fail(`اكتُشف ${carriers.length} محوّلاً فقط`);

    // 🔴 الفحصُ الحرفيّ: اسمُ الناقل **لا يظهر** خارج مجلَّده.
    const root = process.cwd();
    const scanRoots = ["src", "medusa-config.ts"];
    const leaked: string[] = [];

    const files: string[] = [];
    const walk = (p: string) => {
      const st = statSync(p);
      if (st.isDirectory()) {
        if (/node_modules|\.medusa/.test(p)) return;
        for (const n of readdirSync(p) as unknown as string[]) walk(join(p, n));
      } else if (/\.(ts|js|json|md)$/.test(p)) files.push(p);
    };
    for (const r of scanRoots) {
      try {
        walk(join(root, r));
      } catch {
        /* المسارُ غيرُ موجود */
      }
    }

    for (const carrier of carriers) {
      const inCarrierDir = join(root, "src/modules/carriers", carrier.id);
      for (const f of files) {
        if (f.startsWith(inCarrierDir)) continue;
        // مجلَّدُ المحوّلات نفسُه (README والاكتشاف) جزءٌ من الآلة لا خارجَها.
        if (f.startsWith(join(root, "src/modules/carriers"))) continue;
        // البوّابةُ نفسُها تذكر الأسماءَ لتفحصها — واستثناؤها معلَن.
        if (f.endsWith("verify-fulfilment.ts")) continue;
        const text = readFileSync(f, "utf8");
        if (text.includes(carrier.id)) leaked.push(`${carrier.id} ⇐ ${f.slice(root.length + 1)}`);
      }
    }

    leaked.length === 0
      ? pass("**ولا يظهر اسمُ ناقلٍ في أيّ ملفٍّ خارج مجلَّده** — ولا في الإعداد")
      : fail(`تسرّبت أسماء: ${leaked.slice(0, 4).join(" · ")}`);

    // وصلت الاكتشافاتُ إلى Medusa فعلاً؟
    const provs = await pg.raw(`select "id" from "zadim"."fulfillment_provider"`);
    const provIds = ((provs?.rows ?? provs) as any[]).map((r) => r.id);
    const missing = carriers.filter((c) => !provIds.some((p: string) => p.includes(c.id)));
    missing.length === 0
      ? pass(`وسُجّلت كلُّها مزوّدين عند Medusa (${provIds.length} مزوّداً)`)
      : fail(`لم تُسجَّل: ${missing.map((m) => m.id).join(",")}`);

    // ── ٣) الباركود — المنطقُ الخالص ───────────────────────────
    logger.info("== الباركود: المنطق ==");

    const items = [
      { id: "i1", title: "سمّاعة", barcode: "BC-1", quantity: 2, picked_quantity: 0, bin_location: "A-2-1" },
      { id: "i2", title: "بطارية", barcode: "BC-2", quantity: 1, picked_quantity: 0, bin_location: "A-10-3" },
    ];

    const ok = scanBarcode(items, "BC-1");
    ok.accepted && ok.picked_quantity === 1 && !ok.complete
      ? pass("مسحةٌ صحيحةٌ تزيد الملقوط")
      : fail(`المسحة الصحيحة: ${JSON.stringify(ok)}`);

    const wrong = scanBarcode(items, "BC-999");
    !wrong.accepted && wrong.code === "UNKNOWN_BARCODE" && wrong.blocks
      ? pass("**وباركودٌ خارج القائمة يوقف اللقط**")
      : fail(`الباركود الخاطئ: ${JSON.stringify(wrong)}`);

    const done = scanBarcode(
      [{ ...items[1], picked_quantity: 1 }],
      "BC-2"
    );
    !done.accepted && done.code === "ALREADY_COMPLETE" && !done.blocks
      ? pass("ومسحةٌ زائدةٌ لنفس الصنف تُرفض **ولا توقف** — مسحٌ مكرَّرٌ لا خطأُ صنف")
      : fail(`المسحة الزائدة: ${JSON.stringify(done)}`);

    const empty = scanBarcode(items, "  ");
    !empty.accepted && empty.code === "EMPTY_BARCODE" && !empty.blocks
      ? pass("ومسحةٌ فارغةٌ عطلُ جهازٍ لا خطأُ صنف")
      : fail(`المسحة الفارغة: ${JSON.stringify(empty)}`);

    !isComplete(items) && isComplete([{ ...items[0], picked_quantity: 2 }, { ...items[1], picked_quantity: 1 }])
      ? pass("و`isComplete` تفرّق الناقصَ من الكامل")
      : fail("حسابُ الاكتمال خاطئ");

    // ── ٤) ترتيبُ المشي ────────────────────────────────────────
    const walkOrder = assignWalkOrder(items).map((i) => i.id);
    walkOrder.join(",") === "i1,i2"
      ? pass("A-2 قبل A-10 — الفرزُ عدديٌّ لا نصّيّ، فلا يُمشى الممرُّ مرّتين")
      : fail(`ترتيبُ المشي: ${walkOrder.join(",")}`);

    const reversed = assignWalkOrder([...items].reverse()).map((i) => i.id);
    reversed.join(",") === walkOrder.join(",")
      ? pass("والترتيبُ حاسمٌ لا يتبع ترتيبَ المدخل")
      : fail(`ترتيبان مختلفان: ${reversed.join(",")}`);

    // ── ٥) الباركود على القاعدة ────────────────────────────────
    logger.info("== الباركود: على القاعدة ==");

    const [list] = await ful.createPickLists([
      { location_id: `sloc_${tag}`, state: "pending", order_id: `ord_${tag}` },
    ]);
    madeLists.push(list.id);
    await ful.createPickListItems([
      { pick_list_id: list.id, title: "سمّاعة", barcode: `BC-${tag}-1`, quantity: 2, bin_location: "B-1-1" },
      { pick_list_id: list.id, title: "بطارية", barcode: `BC-${tag}-2`, quantity: 1, bin_location: "A-1-1" },
    ]);

    await ful.updatePickLists({ id: list.id, state: "picking" });

    const r1 = await ful.scan(list.id, `BC-${tag}-1`);
    r1.accepted ? pass("مسحةٌ على القاعدة قُبلت") : fail("رُفضت مسحةٌ صحيحة");

    const bad = await ful.scan(list.id, "BC-LA-YUJAD");
    const [afterBad] = await ful.listPickLists({ id: list.id });
    !bad.accepted && (afterBad as any).state === "blocked" && (afterBad as any).blocked_reason
      ? pass("**والباركودُ الخاطئ أوقف القائمة فعلاً** بسببٍ ظاهر")
      : fail(`حالُ القائمة بعد الخطأ: ${(afterBad as any)?.state}`);

    let pickWhileBlocked = false;
    try {
      await ful.scan(list.id, `BC-${tag}-1`);
    } catch {
      pickWhileBlocked = true;
    }
    pickWhileBlocked
      ? pass("ولا يُلقط في قائمةٍ متوقّفة — الإيقافُ إيقافٌ لا تحذير")
      : fail("استمرّ اللقطُ رغم الإيقاف");

    await ful.updatePickLists({ id: list.id, state: "picking", blocked_reason: null });

    let incompleteBlocked = false;
    try {
      await ful.updatePickLists({ id: list.id, state: "picked" });
    } catch {
      incompleteBlocked = true;
    }
    incompleteBlocked
      ? pass("**و`picked` لا تمرّ ناقصةً** — النقصُ يُقيَّد ويُبلَّغ")
      : fail("خُتم لقطٌ ناقص");

    await ful.scan(list.id, `BC-${tag}-1`);
    await ful.scan(list.id, `BC-${tag}-2`);
    const state = await ful.complete(list.id);
    state.complete ? pass("وباكتمال المسح تصير مكتملة") : fail(`لم تكتمل: ${JSON.stringify(state)}`);

    await ful.updatePickLists({ id: list.id, state: "picked" });
    const [picked] = await ful.listPickLists({ id: list.id });
    (picked as any).state === "picked"
      ? pass("فتمرّ إلى picked")
      : fail(`الحالُ بعد الاكتمال: ${(picked as any)?.state}`);

    // انتقالٌ ممنوع
    let badTransition = false;
    try {
      await ful.updatePickLists({ id: list.id, state: "picking" });
    } catch {
      badTransition = true;
    }
    badTransition
      ? pass("و`picked ⇒ picking` ممنوع — ما لُقط لا يُعاد فتحُه")
      : fail("عاد المكتملُ إلى اللقط");

    // ── ٦) الطرد والوزن ────────────────────────────────────────
    logger.info("== الطرد ==");

    let zeroWeight = false;
    try {
      const [p] = await ful.createParcels([{ barcode: `PK-${tag}-0`, weight_grams: 0 }]);
      madeParcels.push(p.id);
    } catch {
      zeroWeight = true;
    }
    zeroWeight
      ? pass("طردٌ بوزنٍ صفرٍ يُرفض — الناقلُ يسعّر بالوزن")
      : fail("قُبل طردٌ بلا وزن");

    const [parcel] = await ful.createParcels([
      { barcode: `PK-${tag}`, weight_grams: 1200, pick_list_id: list.id },
    ]);
    madeParcels.push(parcel.id);

    let dupBarcode = false;
    try {
      const [p2] = await ful.createParcels([{ barcode: `PK-${tag}`, weight_grams: 800 }]);
      madeParcels.push(p2.id);
    } catch {
      dupBarcode = true;
    }
    dupBarcode
      ? pass("وباركودُ طردٍ مكرَّرٌ يُرفض — طردان بنفس الرمز يضيع أحدُهما")
      : fail("قُبل باركودٌ مكرَّر");

    // ── ٧) أحداثُ التتبّع ──────────────────────────────────────
    logger.info("== التتبّع ==");

    const [ev] = await ful.createShipmentEvents([
      {
        fulfillment_id: `ful_${tag}`,
        tracking_number: `ZDM-${tag}`,
        code: "in_transit",
        description_ar: "الشحنةُ في الطريق",
        occurred_at: new Date(),
      },
    ]);

    await pg("zadim.zadim_shipment_event").where({ id: ev.id }).update({ code: "مزوَّر" });
    const [stillThere] = await ful.listShipmentEvents({ id: ev.id });
    (stillThere as any)?.code === "in_transit"
      ? pass("حدثُ تتبّعٍ وقع لا يُعدَّل — والعميلُ قرأه")
      : fail(`عُدِّل الحدث: ${(stillThere as any)?.code}`);

    await pg("zadim.zadim_shipment_event").where({ id: ev.id }).del();
    (await ful.listShipmentEvents({ id: ev.id })).length === 1
      ? pass("ولا يُحذف")
      : fail("حُذف حدثُ تتبّع");
  } finally {
    await pg("zadim.zadim_parcel").whereIn("id", madeParcels).del();
    await pg("zadim.zadim_pick_list_item").whereIn("pick_list_id", madeLists).del();
    await pg("zadim.zadim_pick_list").whereIn("id", madeLists).del();
    // أحداثُ التتبّع تبقى: قاعدةُ «لا حذف» تُسقط حذفَها بصمت.
  }

  if (failures) throw new Error(`[zadim] سقط ${failures} فحصاً من فحوص التنفيذ.`);
  logger.info("✅ كلُّ فحوص المرحلة ٧ اجتازت — لا أجرةَ في الكود، والباركودُ يوقف.");
}
