import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * 🔴 **بوّابةُ المرحلة ١٠ نفسُها** — على جداول Medusa لا على جداولنا.
 *
 * > الراجعُ **لا يعود إلى الرفّ آلياً** — يدخل موقع الحجر والفحصُ بشريّ.
 *
 * وثلاثةُ حرّاسَ هنا يقفون على `return` و`return_item` و`inventory_level`
 * — ولا نملك أياً منها. **وهذا بالضبط سببُ وجودهم في القاعدة**: من
 * يكتب فيها كثيرٌ (سيرُ عمل Medusa، سكربتُ استيراد، مسارٌ يُكتب بعد
 * سنة، `psql` بيدِ مشغّل)، وحارسٌ في خدمةٍ يحرس من ناداها وحدَه.
 */
export class Migration20260901000091 extends Migration {
  async up(): Promise<void> {
    // ── ١) المرتجعُ ينزل في الحجر لا على الرفّ ────────────────────
    //
    // `return.location_id` عند Medusa نصٌّ حرّ. فبلا هذا الحارس يجوز
    // استلامُ مرتجعٍ **في مستودع البيع مباشرةً** — فيصير معروضاً لحظةَ
    // وصوله، قبل أن يراه أحد.
    //
    // ⚠️ و`null` مسموح: مرتجعٌ لم يُحدَّد مكانُه بعد لم يصل، ولم يمسّ
    // مخزوناً. والمنعُ يقع حين يُذكر مكانٌ خاطئ، لا حين يُترك فارغاً.
    this.addSql(`
      create or replace function "zadim_guard_return_location"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_is_returns boolean;
      begin
        if new."location_id" is null then
          return new;
        end if;

        select "is_returns_location" into v_is_returns
          from "zadim_location_profile"
         where "location_id" = new."location_id"
           and "deleted_at" is null;

        -- **وموقعٌ بلا ملفٍّ ليس حجراً.** والافتراضُ هنا منعٌ لا سماح،
        -- بخلاف الشحن (حيث المستودعُ بلا ملفٍّ يُشحن منه): إرسالُ راجعٍ
        -- إلى مكانٍ لا نعرف صفتَه هو بالضبط ما يحرسه هذا.
        if v_is_returns is distinct from true then
          raise exception
            'zadim: المرتجعُ لا يُستلَم إلا في موقع حجر — والموقع % ليس كذلك',
            new."location_id"
            using errcode = 'check_violation';
        end if;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_return_location_trg" on "return";`);
    this.addSql(`
      create trigger "zadim_guard_return_location_trg"
        before insert or update of "location_id" on "return"
        for each row execute function "zadim_guard_return_location"();
    `);

    // ── ٢) انتقالاتُ المرتجع من الجدول لا من الظنّ ───────────────
    this.addSql(`
      create or replace function "zadim_guard_return_transition"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_ok boolean;
      begin
        -- الانتقالُ إلى النفس ليس انتقالاً (نفسُ منطق checkTransition
        -- في orders/transitions.ts): ولولا هذا لَرُفض أيُّ تحديثٍ لا
        -- يمسّ الحالة.
        if new."status" is not distinct from old."status" then
          return new;
        end if;

        -- ⚠️ **الصبُّ إلى نصّ ليس زينة**: عمودُ status عند Medusa تعدادٌ
        -- (return_status_enum) وأعمدةُ جدولنا نصّ، وبلا صبٍّ يسقط
        -- المُطلِقُ بـ«operator does not exist: text = return_status_enum»
        -- — عطلٌ يبدو عطلَ منطقٍ وهو عطلُ نوع.
        select true into v_ok
          from "zadim_return_transition"
         where "from_status" = old."status"::text
           and "to_status"   = new."status"::text
           and "is_active"
           and "deleted_at" is null
         limit 1;

        if v_ok is not true then
          raise exception
            'zadim: انتقالٌ ممنوع للمرتجع: % ⇐ % ليس في جدول الانتقالات',
            old."status"::text, new."status"::text
            using errcode = 'check_violation';
        end if;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_return_transition_trg" on "return";`);
    this.addSql(`
      create trigger "zadim_guard_return_transition_trg"
        before update of "status" on "return"
        for each row execute function "zadim_guard_return_transition"();
    `);

    // ── ٣) لا يُستلَم أكثرُ مما طُلب ─────────────────────────────
    //
    // `received_quantity` عند Medusa بلا سقف. واستلامُ خمسٍ من مرتجعٍ
    // طُلبت فيه ثلاث يعني استرداداً لقطعتين لم يُرسلهما أحد.
    this.addSql(`
      create or replace function "zadim_guard_return_quantity"()
      returns trigger
      language plpgsql
      as $$
      begin
        if coalesce(new."received_quantity", 0) > new."quantity" then
          raise exception
            'zadim: المستلَمُ (%) يتجاوز المطلوبَ (%) في سطر المرتجع',
            new."received_quantity", new."quantity"
            using errcode = 'check_violation';
        end if;

        if coalesce(new."damaged_quantity", 0) > coalesce(new."received_quantity", 0) then
          raise exception
            'zadim: التالفُ (%) يتجاوز المستلَمَ (%) — ولا يُتلف ما لم يصل',
            new."damaged_quantity", new."received_quantity"
            using errcode = 'check_violation';
        end if;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_return_quantity_trg" on "return_item";`);
    this.addSql(`
      create trigger "zadim_guard_return_quantity_trg"
        before insert or update of "received_quantity","damaged_quantity","quantity"
        on "return_item"
        for each row execute function "zadim_guard_return_quantity"();
    `);

    // ── ٤) 🔴 **البوّابة**: لا رفَّ قبل حكمٍ بشريّ ────────────────
    //
    // يقرأ الحارسُ متغيّرَي الجلسة اللذين يضبطهما المُنادي داخل معاملته:
    //
    //     zadim.movement_reason = 'return'
    //     zadim.return_id       = 'return_...'
    //
    // ونفسُ آليّة `zadim.movement_reason` التي يقرأ بها دفترُ الحركات
    // نيّةَ التغيير منذ المرحلة ٣ — فلا آليّةَ ثانيةٌ تُتعلَّم.
    //
    // والحكم: زيادةُ مخزونٍ في موقعٍ **قابلٍ للبيع** سببُها `return`
    // تحتاج شهادةَ فحصٍ نتيجتُها `resellable` **تكفي الكمّية**. ويخصم
    // الحارسُ ما أطلقه من الشهادة بنفسه — فلا تُصرف مرّتين.
    //
    // ⚠️ **وحدُّه يُقال ولا يُطوى** (وهو في ADR-028): من يزيد المخزونَ
    // **بلا** هذا السبب يفعل «تسويةً يدوية» — فعلٌ آخرُ يحتاج صلاحيةً
    // أخرى ويُسجَّل باسم فاعله في سجلّ التدقيق ودفترِ الحركات. وهذا
    // الحارسُ يقطع **الطريقَ الآليّ**، وهو نصُّ البوّابة حرفياً؛ ولا
    // يدّعي منعَ فعلٍ بشريٍّ مقصودٍ موقَّع.
    this.addSql(`
      create or replace function "zadim_guard_return_to_shelf"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_reason      text;
        v_return_id   text;
        v_is_returns  boolean;
        v_delta       integer;
        v_releasable  integer;
        v_left        integer;
        r             record;
        v_take        integer;
      begin
        v_delta := new."stocked_quantity" - old."stocked_quantity";
        if v_delta <= 0 then
          return new;
        end if;

        v_reason := nullif(current_setting('zadim.movement_reason', true), '');
        if v_reason is distinct from 'return' then
          return new;
        end if;

        select "is_returns_location" into v_is_returns
          from "zadim_location_profile"
         where "location_id" = new."location_id"
           and "deleted_at" is null;

        -- الزيادةُ داخل الحجر نفسِه هي **استلامُ** المرتجع، لا إطلاقُه.
        if v_is_returns is true then
          return new;
        end if;

        v_return_id := nullif(current_setting('zadim.return_id', true), '');
        if v_return_id is null then
          raise exception
            'zadim: رجوعٌ إلى الرفّ بلا مرتجعٍ معلوم — والسببُ «return» لا يكفي وحدَه'
            using errcode = 'check_violation';
        end if;

        select coalesce(sum("quantity" - "released_quantity"), 0)
          into v_releasable
          from "zadim_return_inspection"
         where "return_id" = v_return_id
           and "outcome" = 'resellable'
           and "deleted_at" is null
           and ("inventory_item_id" is null
                or "inventory_item_id" = new."inventory_item_id");

        if v_delta > v_releasable then
          raise exception
            'zadim: لا يعود إلى الرفّ إلا ما فُحص وحُكم بسلامته — المطلوب % والمُجاز % (مرتجع %)',
            v_delta, v_releasable, v_return_id
            using errcode = 'check_violation';
        end if;

        -- ويُصرف المُجاز من الشهادات بترتيب إصدارها، فلا يُصرف مرّتين.
        v_left := v_delta;
        for r in
          select "id", ("quantity" - "released_quantity") as "avail"
            from "zadim_return_inspection"
           where "return_id" = v_return_id
             and "outcome" = 'resellable'
             and "deleted_at" is null
             and ("inventory_item_id" is null
                  or "inventory_item_id" = new."inventory_item_id")
             and ("quantity" - "released_quantity") > 0
           order by "created_at", "id"
           for update
        loop
          exit when v_left <= 0;
          v_take := least(v_left, r."avail");
          update "zadim_return_inspection"
             set "released_quantity" = "released_quantity" + v_take,
                 "updated_at" = now()
           where "id" = r."id";
          v_left := v_left - v_take;
        end loop;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_return_to_shelf_trg" on "inventory_level";`);
    this.addSql(`
      create trigger "zadim_guard_return_to_shelf_trg"
        before update of "stocked_quantity" on "inventory_level"
        for each row execute function "zadim_guard_return_to_shelf"();
    `);

    // وتُسجَّل الحرّاسُ في سجلّ السلامة كما في المراحل السابقة — كي
    // يُقرأ ما تحرسه القاعدةُ بجملة `select` لا بقراءة هجرات.
    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_ret_loc','return','zadim_guard_return_location_trg',
         'المرتجعُ لا يُستلَم إلا في موقع حجر — لا على رفّ البيع'),
        ('intg_ret_trn','return','zadim_guard_return_transition_trg',
         'انتقالاتُ المرتجع من جدولها — والملغى لا يُستلَم'),
        ('intg_ret_qty','return_item','zadim_guard_return_quantity_trg',
         'لا يُستلَم أكثرُ مما طُلب، ولا يُتلف ما لم يصل'),
        ('intg_ret_shelf','inventory_level','zadim_guard_return_to_shelf_trg',
         'لا يعود إلى الرفّ إلا ما فُحص وحُكم بسلامته — والحكمُ بشريّ')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_guard_return_to_shelf_trg" on "inventory_level";`);
    this.addSql(`drop trigger if exists "zadim_guard_return_quantity_trg" on "return_item";`);
    this.addSql(`drop trigger if exists "zadim_guard_return_transition_trg" on "return";`);
    this.addSql(`drop trigger if exists "zadim_guard_return_location_trg" on "return";`);
    this.addSql(`drop function if exists "zadim_guard_return_to_shelf"();`);
    this.addSql(`drop function if exists "zadim_guard_return_quantity"();`);
    this.addSql(`drop function if exists "zadim_guard_return_transition"();`);
    this.addSql(`drop function if exists "zadim_guard_return_location"();`);
    this.addSql(`delete from "zadim_integrity_check" where "id" like 'intg_ret_%';`);
  }
}
