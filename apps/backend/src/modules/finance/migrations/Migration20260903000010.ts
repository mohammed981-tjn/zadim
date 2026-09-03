import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * `unit_cost` المُجمَّدة — بندٌ من جدول «**ما لا يُؤجَّل مهما ضاق الوقت**»
 * في [`07-roadmap.md`]، حجّتُه: «**ربحُ الماضي لا يُحسب بتكلفة اليوم**».
 *
 * ── لماذا الآن، ولماذا كان غائباً ────────────────────────────────
 *
 * مخطَّطُ المرحلة ٠ (`02-database-schema.sql`) يحمل عمودَ التكلفة.
 * والانتقالُ إلى Medusa **أسقطه بلا قرارٍ مكتوب**: قِيس على القاعدة
 * الحيّة في 2026-09-03 فكان **صفرَ عمودٍ** باسم `unit_cost` أو `cost`.
 * وهو بالضبط ما وُضع ذلك الجدولُ ليمنعه.
 *
 * وكلفةُ التأخير ليست في الهجرة وحدَها بل فيما **لا يُستدرَك**: عمودٌ
 * يُضاف غداً يبقى `null` لكل سطرٍ بيع قبله. فربحُ الأشهر الماضية لا
 * يُحسب — **لا اليوم ولا أبداً**، لأن التكلفةَ التي كانت لم تُسجَّل.
 * فاليومُ أرخصُ يومٍ ممكن، والغدُ أغلى.
 *
 * ── لماذا التجميدُ في مُطلِقٍ لا في كودِ التطبيق ───────────────────
 *
 * لأن سطرَ الطلب يُكتب من **طرقٍ كثيرة**: سيرُ عمل الشراء، والطلبُ
 * المسوَّدة من اللوحة، والاستبدال، والتصحيحُ الإداريّ. وكلُّ طريقٍ
 * ينسى التجميدَ يترك سطراً بلا تكلفة — ولا يشكو منه شيء، إنما يظهر
 * بعد شهورٍ في تقريرٍ يقول إن هامشَ هذا الصنف ١٠٠٪.
 *
 * والمُطلِقُ يمرّ به كلُّ طريقٍ بلا استثناء، لأنه في القاعدة لا في
 * التطبيق. وهو نفسُ منطق `modules/integrity`.
 *
 * ── والتجميدُ يعني أنه لا يُكتب مرّتين ───────────────────────────
 *
 * «مجمَّدة» ليست وصفاً لطيفاً: هي **قيدٌ مفروض**. فمُطلِقُ التحديث
 * يرفض تغييرَ `unit_cost` بعد أن يُملأ. ولولاه لكانت كلمةُ «مجمَّدة»
 * نيّةً حسنةً يكسرها أوّلُ `update` من لوحةٍ أو سكربتِ تصحيح — ثم
 * يتغيّر ربحُ يناير في مارس، وهو عينُ ما نمنعه.
 *
 * والاستثناءُ الوحيد: من `null` إلى قيمة. صفوفٌ سبقت هذه الهجرةَ
 * تبقى `null` (لا تكلفةَ لها ولا يمكن اختراعُها)، ومن عرف تكلفتَها
 * حقاً يملؤها **مرّةً**.
 *
 * ── ولماذا `null` لا صفر ─────────────────────────────────────────
 *
 * صفرٌ يعني «كلّفنا لا شيء» — وهو رقمٌ يدخل الحسابَ فيرفع الهامشَ إلى
 * ١٠٠٪. و`null` يعني «**لا نعرف**» فيخرج من الحساب. والفرقُ بينهما
 * تقريرٌ صادقٌ وتقريرٌ يكذب بثقة.
 */
export class Migration20260903000010 extends Migration {
  async up(): Promise<void> {
    // ── ١) سجلُّ التكلفة النافذة ─────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_variant_cost" (
        "id"             text not null,
        "variant_id"     text not null,
        "unit_cost"      integer not null,
        "source"         text not null default 'manual',
        "effective_from" timestamptz not null default now(),
        "effective_to"   timestamptz null,
        "note"           text null,
        "created_at"     timestamptz not null default now(),
        "updated_at"     timestamptz not null default now(),
        "deleted_at"     timestamptz null,
        constraint "zadim_variant_cost_pkey" primary key ("id"),
        -- بالهللات صحيحةً (ADR-008). والسالبُ ليس تكلفةً بل خطأَ إدخال.
        constraint "zadim_variant_cost_nonneg" check ("unit_cost" >= 0),
        constraint "zadim_variant_cost_window" check (
          "effective_to" is null or "effective_to" > "effective_from"
        )
      );
    `);

    // صفٌّ نافذٌ واحدٌ للمتغيّر. ولولا هذا لصار «التكلفةُ الحاليّة»
    // سؤالاً جوابُه يعتمد على أيِّ صفٍّ قرأه المحرّك أوّلاً.
    this.addSql(`
      create unique index if not exists "IDX_zadim_variant_cost_current"
        on "zadim_variant_cost" ("variant_id")
        where "effective_to" is null and "deleted_at" is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_variant_cost_variant"
        on "zadim_variant_cost" ("variant_id", "effective_from" desc);
    `);

    // ── ٢) العمودُ المجمَّد على سطر الطلب ────────────────────────
    //
    // `null` مسموحٌ عمداً — انظر «ولماذا `null` لا صفر» أعلاه.
    this.addSql(`
      alter table "order_line_item"
        add column if not exists "unit_cost" integer null,
        add column if not exists "unit_cost_source" text null;
    `);
    this.addSql(`
      alter table "order_line_item"
        drop constraint if exists "zadim_order_line_item_unit_cost_nonneg";
    `);
    this.addSql(`
      alter table "order_line_item"
        add constraint "zadim_order_line_item_unit_cost_nonneg"
        check ("unit_cost" is null or "unit_cost" >= 0);
    `);

    // وسطرُ السلّة يحمله أيضاً: التكلفةُ تُقرأ مرّةً عند الإضافة إلى
    // السلّة فيُعرف هامشُ السلّة قبل أن تصير طلباً — ولأن سطرَ الطلب
    // يُنسخ من سطر السلّة، فوجودُه هنا يجعل النسخَ يحمله معه.
    this.addSql(`
      alter table "cart_line_item"
        add column if not exists "unit_cost" integer null;
    `);

    // ── ٣) التجميد: يُملأ عند الإدراج من السجلّ النافذ ───────────
    this.addSql(`
      create or replace function "zadim_freeze_unit_cost"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_cost   integer;
        v_source text;
      begin
        -- ما وصل محمَّلاً بتكلفةٍ يُترك: سطرُ الطلب المنسوخُ من سطر
        -- سلّةٍ يحمل تكلفةَ **لحظةِ الإضافة**، وهي أصدقُ من تكلفةِ
        -- لحظةِ الدفع حين يفصل بينهما أسبوع.
        if new."unit_cost" is not null then
          return new;
        end if;

        if new."variant_id" is null then
          return new;   -- سطرٌ مخصَّصٌ بلا متغيّر: لا تكلفةَ تُعرف له.
        end if;

        select c."unit_cost", c."source"
          into v_cost, v_source
          from "zadim_variant_cost" c
         where c."variant_id" = new."variant_id"
           and c."effective_to" is null
           and c."deleted_at" is null
         limit 1;

        if v_cost is null then
          -- لا تكلفةَ مسجَّلة. يمرّ السطرُ بـ null ولا يُرفض: رفضُ
          -- البيع لأن المحاسبةَ ناقصةٌ يوقف المتجرَ على تقرير.
          return new;
        end if;

        new."unit_cost" := v_cost;
        if tg_table_name = 'order_line_item' then
          new."unit_cost_source" := coalesce(v_source, 'manual');
        end if;
        return new;
      end;
      $$;
    `);

    this.addSql(`drop trigger if exists "zadim_freeze_unit_cost_trg" on "order_line_item";`);
    this.addSql(`
      create trigger "zadim_freeze_unit_cost_trg"
        before insert on "order_line_item"
        for each row
        execute function "zadim_freeze_unit_cost"();
    `);

    this.addSql(`drop trigger if exists "zadim_freeze_unit_cost_trg" on "cart_line_item";`);
    this.addSql(`
      create trigger "zadim_freeze_unit_cost_trg"
        before insert on "cart_line_item"
        for each row
        execute function "zadim_freeze_unit_cost"();
    `);

    // ── ٤) والمجمَّدُ لا يُكتب مرّتين ────────────────────────────
    this.addSql(`
      create or replace function "zadim_unit_cost_immutable"()
      returns trigger
      language plpgsql
      as $$
      begin
        if old."unit_cost" is not null
           and new."unit_cost" is distinct from old."unit_cost" then
          raise exception
            'zadim: unit_cost مجمَّدةٌ لحظةَ البيع ولا تُغيَّر (line=%, من % إلى %)',
            old."id", old."unit_cost", new."unit_cost"
            using errcode = 'check_violation';
        end if;
        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_unit_cost_immutable_trg" on "order_line_item";`);
    this.addSql(`
      create trigger "zadim_unit_cost_immutable_trg"
        before update on "order_line_item"
        for each row
        execute function "zadim_unit_cost_immutable"();
    `);

    // ── ٥) وإغلاقُ الصفّ السابق حين تُسجَّل تكلفةٌ جديدة ─────────
    //
    // في القاعدة لا في الخدمة: كاتبٌ ينسى الإغلاق يترك صفَّين نافذَين،
    // فيسقط على الفهرس الفريد أعلاه — وهو رفضٌ صحيحٌ لكنه رسالةٌ لا
    // يفهمها أحد. والأصوبُ أن يُغلق السابقُ من نفسِه.
    //
    // 🔴 **وقبليٌّ لا بعديّ — وهذا ما أمسكته البوّابة.** كُتب أوّلاً
    // `after insert`، فسقط ثاني تسجيلٍ بـ«already exists»: الفهرسُ
    // الفريدُ غيرُ مؤجَّل، فيُفحص لحظةَ إدراج الصفّ الجديد **قبل** أن
    // يعمل المُطلِقُ البعديّ فيغلق السابق. والقبليُّ يغلق أوّلاً
    // فيجد الفهرسُ صفّاً نافذاً واحداً.
    //
    // ولا دورةَ فيه: التحديثُ يمسّ صفوفاً أخرى ولا يوقظ إلا مُطلِقاتِ
    // `update`، ولا مُطلِقَ لها هنا.
    this.addSql(`
      create or replace function "zadim_close_previous_cost"()
      returns trigger
      language plpgsql
      as $$
      begin
        if new."effective_to" is null and new."deleted_at" is null then
          update "zadim_variant_cost"
             set "effective_to" = greatest(
                   new."effective_from",
                   "effective_from" + interval '1 microsecond'
                 ),
                 "updated_at" = now()
           where "variant_id" = new."variant_id"
             and "id" <> new."id"   -- احتياطاً: إعادةُ إدراجٍ بنفس المعرّف
             and "effective_to" is null
             and "deleted_at" is null;
        end if;
        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_close_previous_cost_trg" on "zadim_variant_cost";`);
    this.addSql(`
      create trigger "zadim_close_previous_cost_trg"
        before insert on "zadim_variant_cost"
        for each row
        execute function "zadim_close_previous_cost"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_cost_freeze','order_line_item','zadim_freeze_unit_cost_trg',
         'unit_cost تُجمَّد لحظةَ البيع من السجلّ النافذ — ربحُ الماضي لا يُحسب بتكلفة اليوم'),
        ('intg_cost_immut','order_line_item','zadim_unit_cost_immutable_trg',
         'unit_cost المملوءة لا تُغيَّر — وإلا صارت «مجمَّدة» نيّةً يكسرها أوّلُ تصحيح')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_unit_cost_immutable_trg" on "order_line_item";`);
    this.addSql(`drop trigger if exists "zadim_freeze_unit_cost_trg" on "order_line_item";`);
    this.addSql(`drop trigger if exists "zadim_freeze_unit_cost_trg" on "cart_line_item";`);
    this.addSql(`drop trigger if exists "zadim_close_previous_cost_trg" on "zadim_variant_cost";`);
    this.addSql(`drop function if exists "zadim_unit_cost_immutable"();`);
    this.addSql(`drop function if exists "zadim_freeze_unit_cost"();`);
    this.addSql(`drop function if exists "zadim_close_previous_cost"();`);
    this.addSql(`
      alter table "order_line_item"
        drop constraint if exists "zadim_order_line_item_unit_cost_nonneg";
    `);
    // العمودان يبقيان: إسقاطُهما يمحو تكلفةَ كلِّ ما بيع — وهي بيانات
    // لا تُستعاد. والتراجعُ يرفع الحراسةَ لا الحقيقة.
    this.addSql(`delete from "zadim_integrity_check" where "id" in ('intg_cost_freeze','intg_cost_immut');`);
    this.addSql(`drop table if exists "zadim_variant_cost" cascade;`);
  }
}
