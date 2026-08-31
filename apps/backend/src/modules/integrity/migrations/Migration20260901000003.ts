import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * جعلُ `reserved_quantity` **مشتقّاً دائماً** لا حقلاً يُكتب.
 *
 * ── ما قِيس بعد الهجرة السابقة ───────────────────────────────────
 *
 * المُطلِقُ منع البيعَ الزائد فعلاً — عشرةٌ بالضبط من مئة محاولة. لكن:
 *
 * ```
 * نجحت: 10 · صفوفُ الحجز: 10 · stocked=10 reserved=2 available=8
 * ```
 *
 * **عشرةُ حجوزاتٍ والعدّاد يقول اثنين.** والسببُ أن Medusa يكتب
 * `reserved_quantity` بنفسه **بعد** المُطلِق فيمحو تصحيحه، وحسابُه
 * قراءةٌ-ثم-كتابةٌ يفسدها التزاحم.
 *
 * وأثرُ ذلك ليس تجميلياً: `available = 8` يجعل المتجرَ يعرض «متوفّر»
 * لبضاعةٍ نفدت، فيدخل العميلُ Checkout **ويفشل عند آخر خطوة**. وهذه
 * أسوأُ لحظةٍ ممكنة لإخباره.
 *
 * ── العلاج: الحقلُ يُشتقّ ولا يُكتب ──────────────────────────────
 *
 * مُطلِقان يعملان معاً:
 *
 * ١. على `reservation_item` — **بعد** الإدراج لا قبله. فالصفُّ موجودٌ
 *    حينها والمجموعُ كامل، ولا يحتاج جمعاً يدوياً يُخطئ. والرفعُ
 *    (`raise`) في مُطلِقٍ بعديّ يُسقط المعاملةَ كما القبليّ سواء.
 *
 * ٢. على `inventory_level` — **قبل** التحديث: أيُّ كتابةٍ للحقل تُستبدل
 *    بالمجموع الحقيقي. فمن يكتب رقماً خاطئاً — Medusa أو غيرُه — يُصحَّح
 *    لا يُرفض، لأن الرفضَ هنا يُسقط عملياتٍ سليمةً لسببٍ لا يفهمه
 *    كاتبُها.
 *
 * ولا دورةَ بينهما: الأولُ **لا يحسب شيئاً**، إنما يلمس صفَّ المستوى
 * (`updated_at`) فيُشغّل الثاني، والثاني وحده يشتقّ. فموضعُ الاشتقاق
 * واحدٌ لا اثنان — وحسابان في مكانين يفترقان يوماً.
 *
 * ── وأصعبُ ما فيها: البياناتُ الفاسدةُ السابقة ────────────────────
 *
 * أولُ محاولةٍ لتشغيل هذه الهجرة **سقطت**:
 *
 * ```
 * Failing row contains (… stocked=10, reserved=94 …)
 * ```
 *
 * صفوفٌ خلّفتها تجاربُ الاستقصاء: أربعةٌ وتسعون حجزاً على مخزونِ عشرة.
 * فالتسويةُ الصادقة (`reserved := SUM`) تُنتج رقماً **يخالف قيدَ
 * `zadim_reserved_within_stocked`** المفروضَ في الهجرة الأولى، فتسقط
 * الهجرةُ ويقف النشر.
 *
 * وثلاثةُ طرقٍ لا رابع:
 *
 * | | لماذا رُفض |
 * |---|---|
 * | تُسقَط الهجرة ويُصلح المشغّل يدوياً | نشرٌ يقف أمام فسادٍ **قد لا يعلم به أحد**، والهجرةُ تصير غيرَ قابلةٍ لإعادة التشغيل |
 * | تُحذف الحجوزاتُ الزائدة | حذفُ حجوزِ عملاءَ بصمتٍ لتُرضي قيداً — أسوأُ ما يمكن |
 * | **تُقصَّ للحدّ ويُسجَّل الخرق** | ✅ المُتَّبع |
 *
 * فالعدّادُ يُقصّ إلى `LEAST(SUM, stocked)`، **والحقيقةُ لا تُمسّ**: صفوفُ
 * `reservation_item` كلُّها باقيةٌ كما هي. والقصُّ في الاتجاه **الآمن**:
 * `available = 0` — «نفد» لا «متوفّر». ويُقيَّد الخرقُ في
 * `zadim_integrity_breach` باسمه وأرقامه، فيراه من يفتحُ الجدولَ بدل أن
 * يذوب في صمت.
 *
 * والقصُّ في المُطلِق أيضاً لا في التسوية وحدها — وإلا لأسقط أولُ تحديثٍ
 * على صفٍّ قديمٍ مخالف عمليةً سليمةً لا ذنبَ لها.
 *
 * ── الكلفة ───────────────────────────────────────────────────────
 *
 * جمعٌ على حجوزات المادة في الموقع عند كل تحديثِ مستوى. وفهرسُ
 * `(inventory_item_id, location_id)` موجودٌ عند Medusa، فالجمعُ على
 * عشراتٍ لا آلاف. ويوم تصير الحجوزاتُ الحيّة لمادةٍ واحدة بالآلاف
 * يُعاد النظر — وذاك متجرٌ آخر.
 */
export class Migration20260901000003 extends Migration {
  async up(): Promise<void> {
    // ── ٠) سجلُّ الخروق: ما وجدناه فاسداً ولم نستطع إصلاحه صدقاً ──
    this.addSql(`
      create table if not exists "zadim_integrity_breach" (
        "id"            text not null,
        "target_table"  text not null,
        "subject"       text not null,
        "detail"        jsonb not null default '{}'::jsonb,
        "reason_ar"     text not null,
        "detected_at"   timestamptz not null default now(),
        constraint "zadim_integrity_breach_pkey" primary key ("id")
      );
    `);

    // ── ١) حارسُ الحجز: بعديٌّ لا قبليّ، ولا يحسب — يلمس فيُشتقّ ──
    this.addSql(`
      create or replace function "zadim_guard_reservation"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_item text;
        v_loc  text;
        v_stocked numeric;
        v_reserved numeric;
      begin
        v_item := coalesce(new."inventory_item_id", old."inventory_item_id");
        v_loc  := coalesce(new."location_id", old."location_id");

        -- القفلُ يُسلسل المتزاحمين: الثاني ينتظر هنا فيقرأ مجموعاً
        -- محدَّثاً لا قديماً. وهو ما ينقص القراءةَ-ثم-الكتابة في التطبيق.
        select "stocked_quantity" into v_stocked
          from "inventory_level"
         where "inventory_item_id" = v_item
           and "location_id" = v_loc
           and "deleted_at" is null
         for update;

        if v_stocked is null then
          -- لا مستوى: حجزٌ على العدم. يُرفض عند الإنشاء، ويُتجاوز عند
          -- الحذف — فحذفُ حجزٍ يتيمٍ يجب أن يمرّ لا أن يعلق.
          if tg_op = 'DELETE' or new."deleted_at" is not null then
            return coalesce(new, old);
          end if;
          raise exception
            'zadim: حجزٌ على موقعٍ بلا مستوى مخزون (item=%, location=%)', v_item, v_loc
            using errcode = 'check_violation';
        end if;

        -- الصفُّ الجديد **مُدرَجٌ فعلاً** هنا، فالمجموعُ كاملٌ بلا جمعٍ يدويّ.
        select coalesce(sum("quantity"), 0) into v_reserved
          from "reservation_item"
         where "inventory_item_id" = v_item
           and "location_id" = v_loc
           and "deleted_at" is null;

        if v_reserved > v_stocked then
          raise exception
            'zadim: بيعٌ زائد — المطلوب % والموجود % (item=%)', v_reserved, v_stocked, v_item
            using errcode = 'check_violation';
        end if;

        -- لمسةٌ لا حساب: التحديثُ يُشغّل "zadim_derive_reserved" وهو
        -- وحده يشتقّ. وحسابان في موضعين يفترقان يوماً، وأحدُهما يكذب.
        update "inventory_level"
           set "updated_at" = now()
         where "inventory_item_id" = v_item
           and "location_id" = v_loc
           and "deleted_at" is null;

        return coalesce(new, old);
      end;
      $$;
    `);

    this.addSql(`drop trigger if exists "zadim_guard_reservation_trg" on "reservation_item";`);
    this.addSql(`
      create trigger "zadim_guard_reservation_trg"
        after insert or update or delete
        on "reservation_item"
        for each row
        execute function "zadim_guard_reservation"();
    `);

    // ── ٢) العدّادُ مشتقٌّ: أيُّ كتابةٍ له تُستبدل بالمجموع ───────
    this.addSql(`
      create or replace function "zadim_derive_reserved"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_reserved numeric;
      begin
        select coalesce(sum("quantity"), 0) into v_reserved
          from "reservation_item"
         where "inventory_item_id" = new."inventory_item_id"
           and "location_id" = new."location_id"
           and "deleted_at" is null;

        -- القصُّ للحدّ: صفوفٌ فسدت قبل الحراسة يبقى مجموعُها فوق الموجود،
        -- ولولا القصُّ لأسقط القيدُ أولَ تحديثٍ يمرّ عليها — عمليةً سليمةً
        -- لا ذنبَ لها. والقصُّ في الاتجاه الآمن: available = 0 «نفد».
        if v_reserved > new."stocked_quantity" then
          v_reserved := new."stocked_quantity";
        end if;

        if new."reserved_quantity" is distinct from v_reserved then
          new."reserved_quantity" := v_reserved;
          new."raw_reserved_quantity" :=
            jsonb_build_object('value', v_reserved::text, 'precision', 20);
        end if;

        return new;
      end;
      $$;
    `);

    this.addSql(`drop trigger if exists "zadim_derive_reserved_trg" on "inventory_level";`);
    this.addSql(`
      create trigger "zadim_derive_reserved_trg"
        before update on "inventory_level"
        for each row
        execute function "zadim_derive_reserved"();
    `);

    // ── ٣) تقييدُ الخروق السابقة قبل التسوية ─────────────────────
    // يُسجَّل قبل القصّ لا بعده: بعد القصّ يضيع الرقمُ الحقيقي فلا يبقى
    // ما يدلّ على أن هنا فساداً كان.
    this.addSql(`
      insert into "zadim_integrity_breach" ("id","target_table","subject","detail","reason_ar")
      select
        'brch_' || lvl."id",
        'inventory_level',
        lvl."id",
        jsonb_build_object(
          'inventory_item_id', lvl."inventory_item_id",
          'location_id',       lvl."location_id",
          'stocked_quantity',  lvl."stocked_quantity",
          'counter_before',    lvl."reserved_quantity",
          'reservation_sum',   sub.total
        ),
        'مجموعُ الحجوزات يتجاوز الموجود — فسادٌ سابقٌ للحراسة، قُصَّ العدّادُ للحدّ ولم تُمسّ الحجوزات'
      from "inventory_level" lvl
      join (
        select "inventory_item_id", "location_id", coalesce(sum("quantity"), 0) as total
          from "reservation_item"
         where "deleted_at" is null
         group by 1, 2
      ) sub
        on sub."inventory_item_id" = lvl."inventory_item_id"
       and sub."location_id" = lvl."location_id"
      where sub.total > lvl."stocked_quantity"
      on conflict ("id") do nothing;
    `);

    // ── ٤) التسوية ───────────────────────────────────────────────
    // على **كل** المستويات لا على ما له حجوزاتٌ فقط: مستوىً عدّادُه
    // ثلاثةٌ وحجوزاتُه صفرٌ فاسدٌ أيضاً، ووصلةٌ داخلية تتخطّاه.
    this.addSql(`
      update "inventory_level" lvl
         set "reserved_quantity" = sub.v,
             "raw_reserved_quantity" =
               jsonb_build_object('value', sub.v::text, 'precision', 20)
        from (
          select l."id",
                 least(
                   coalesce((
                     select sum(r."quantity") from "reservation_item" r
                      where r."inventory_item_id" = l."inventory_item_id"
                        and r."location_id" = l."location_id"
                        and r."deleted_at" is null
                   ), 0),
                   l."stocked_quantity"
                 ) as v
            from "inventory_level" l
        ) sub
       where lvl."id" = sub."id"
         and lvl."reserved_quantity" is distinct from sub.v;
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_derive','inventory_level','zadim_derive_reserved_trg',
              'reserved_quantity مشتقٌّ من مجموع الحجوزات — يمنع عدّاداً يكذب فيَعِد بما نفد')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_derive_reserved_trg" on "inventory_level";`);
    this.addSql(`drop function if exists "zadim_derive_reserved"();`);
    this.addSql(`drop table if exists "zadim_integrity_breach" cascade;`);
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_derive';`);
  }
}
