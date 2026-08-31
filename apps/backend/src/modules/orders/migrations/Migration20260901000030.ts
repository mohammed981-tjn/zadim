import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة orders — آلةُ الحالات وصندوقُ الأحداث وحرمةُ الفاتورة.
 *
 * ── ما قِيس على Medusa 2.19.0 قبل كتابة سطرٍ من هذا ──────────────
 *
 * ```
 * ألغِ طلباً ثم أعِده إلى pending  ⇒  🔴 عاد حيّاً، بلا اعتراض
 * غيّر سعرَ المنتج بعد الطلب       ⇒  ✅ الفاتورةُ مجمَّدة
 * UPDATE order_line_item SET …     ⇒  🔴 مرّت: الفاتورةُ تُعاد كتابتُها
 * ```
 *
 * فلا حارسَ على انتقالات الحالة إطلاقاً، **والملغى يُحيا**. وقيدُ
 * `CHECK` لا يكفي: الانتقالُ علاقةٌ بين القيمة القديمة والجديدة، و`CHECK`
 * لا يرى إلا الجديدة. فالمُطلِقُ هو الأداةُ الوحيدة التي ترى الاثنتين.
 *
 * ── ولماذا في القاعدة لا في دالّةٍ واحدةٍ في الكود ───────────────
 *
 * الوثيقة اقترحت **قاعدة lint** تمنع `UPDATE orders SET status` خارج
 * دالّةٍ واحدة. وهي تحرس ما نكتبه نحن، **ولا ترى سيرَ عمل Medusa نفسَه**
 * — وهو من يُلغي الطلبات فعلاً — ولا سكربتَ استيراد، ولا `psql` بيدِ
 * مشغّل. والمُطلِقُ يرى الجميع.
 *
 * والجدولُ الذي يقرؤه المُطلِق **هو نفسُه** الذي تقرؤه اللوحةُ والخدمة:
 * حارسٌ ووثيقةٌ شيءٌ واحد، لا نسختان تفترقان.
 */
export class Migration20260901000030 extends Migration {
  async up(): Promise<void> {
    // ── ١) جدولُ الانتقالات — بيانات ─────────────────────────────
    this.addSql(`
      create table if not exists "zadim_order_transition" (
        "id"                   text not null,
        "from_status"          text not null,
        "to_status"            text not null,
        "requires_no_shipment" boolean not null default false,
        "reason_ar"            text not null,
        "is_active"            boolean not null default true,
        "created_at"           timestamptz not null default now(),
        "updated_at"           timestamptz not null default now(),
        "deleted_at"           timestamptz null,
        constraint "zadim_order_transition_pkey" primary key ("id"),
        constraint "zadim_order_transition_not_self" check ("from_status" <> "to_status")
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_order_transition_pair"
        on "zadim_order_transition" (from_status, to_status) where deleted_at is null;
    `);

    // الحالاتُ حالاتُ Medusa لا حالاتُ الوثيقة حرفياً — انظر
    // `transitions.ts` لسبب ذلك. ولا صفَّ إلى `canceled` أو من
    // `completed` إلا الأرشفة: **النهائيُّ نهائيّ**.
    this.addSql(`
      insert into "zadim_order_transition"
        ("id","from_status","to_status","requires_no_shipment","reason_ar")
      values
        ('otrn_dr_pe','draft','pending',false,'مسوّدةٌ صارت طلباً'),
        ('otrn_dr_ca','draft','canceled',false,'مسوّدةٌ أُلغيت قبل أن تصير طلباً'),
        ('otrn_dr_ar','draft','archived',false,'مسوّدةٌ حُفظت'),
        ('otrn_pe_co','pending','completed',false,'كلُّ البنود نُفِّذت أو رُدّت'),
        ('otrn_pe_ca','pending','canceled',true,'إلغاءٌ قبل أن تخرج أيُّ شحنة'),
        ('otrn_pe_ra','pending','requires_action',false,'الدفعُ يحتاج إجراءً من العميل'),
        ('otrn_pe_ar','pending','archived',false,'أُخرج من المتابعة اليومية'),
        ('otrn_ra_pe','requires_action','pending',false,'أُنجز الإجراءُ المطلوب'),
        ('otrn_ra_co','requires_action','completed',false,'اكتمل رغم مرورِه بإجراء'),
        ('otrn_ra_ca','requires_action','canceled',true,'تعذّر الإجراءُ فأُلغي'),
        ('otrn_co_ar','completed','archived',false,'مكتملٌ أُخرج من المتابعة — والأرشفةُ حفظٌ لا تراجع')
      on conflict do nothing;
    `);

    // ── ٢) صندوقُ الأحداث ───────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_outbox_event" (
        "id"             text not null,
        "event"          text not null,
        "aggregate_type" text not null,
        "aggregate_id"   text not null,
        "payload"        jsonb null,
        "occurred_at"    timestamptz not null default now(),
        "delivered_at"   timestamptz null,
        "attempts"       integer not null default 0,
        "last_error"     text null,
        "created_at"     timestamptz not null default now(),
        "updated_at"     timestamptz not null default now(),
        "deleted_at"     timestamptz null,
        constraint "zadim_outbox_event_pkey" primary key ("id"),
        constraint "zadim_outbox_event_attempts_check" check ("attempts" >= 0)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_outbox_event_aggregate"
        on "zadim_outbox_event" (aggregate_type, aggregate_id);
    `);
    // الاستعلامُ الوحيد الذي يهمّ العاملَ: «ما لم يُسلَّم، الأقدمُ أوّلاً».
    // وفهرسٌ جزئيٌّ عليه يبقى صغيراً مهما كبر الصندوق — فالمُسلَّمُ
    // خارجَه.
    this.addSql(`
      create index if not exists "IDX_zadim_outbox_event_pending"
        on "zadim_outbox_event" (occurred_at) where delivered_at is null;
    `);

    // ما وقع لا يُعاد كتابتُه؛ وما يخصّ التسليم يُكتب مراراً.
    this.addSql(`
      create or replace function "zadim_outbox_immutable"()
      returns trigger
      language plpgsql
      as $$
      begin
        if new."event" is distinct from old."event"
           or new."aggregate_type" is distinct from old."aggregate_type"
           or new."aggregate_id" is distinct from old."aggregate_id"
           or new."payload" is distinct from old."payload"
           or new."occurred_at" is distinct from old."occurred_at" then
          raise exception 'zadim: حدثٌ وقع لا يُعاد كتابتُه (%)', old."id"
            using errcode = 'check_violation';
        end if;
        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_outbox_immutable_trg" on "zadim_outbox_event";`);
    this.addSql(`
      create trigger "zadim_outbox_immutable_trg"
        before update on "zadim_outbox_event"
        for each row execute function "zadim_outbox_immutable"();
    `);
    this.addSql(`create or replace rule "zadim_outbox_no_delete" as
                 on delete to "zadim_outbox_event" do instead nothing;`);

    // ── ٣) سجلُّ تغيّرات الفاتورة ───────────────────────────────
    this.addSql(`
      create table if not exists "zadim_invoice_change" (
        "id"           text not null,
        "order_id"     text not null,
        "line_item_id" text not null,
        "field"        text not null,
        "old_value"    text null,
        "new_value"    text null,
        "actor_id"     text null,
        "created_at"   timestamptz not null default now(),
        "updated_at"   timestamptz not null default now(),
        "deleted_at"   timestamptz null,
        constraint "zadim_invoice_change_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_invoice_change_order"
        on "zadim_invoice_change" (order_id);
    `);
    this.addSql(`create or replace rule "zadim_invoice_change_no_update" as
                 on update to "zadim_invoice_change" do instead nothing;`);
    this.addSql(`create or replace rule "zadim_invoice_change_no_delete" as
                 on delete to "zadim_invoice_change" do instead nothing;`);

    // ── ٤) 🔴 حارسُ الانتقال ────────────────────────────────────
    this.addSql(`
      create or replace function "zadim_guard_order_transition"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_rule record;
        v_shipped int;
      begin
        -- الانتقالُ إلى النفس ليس انتقالاً. ولولا هذا لَرُفض أيُّ تحديثٍ
        -- لطلبٍ لا يمسّ حالته.
        if new."status" is not distinct from old."status" then
          return new;
        end if;

        select * into v_rule
          from "zadim_order_transition"
         where "from_status" = old."status"::text
           and "to_status" = new."status"::text
           and "is_active"
           and "deleted_at" is null;

        if not found then
          raise exception
            'zadim: انتقالٌ ممنوع % ⇐ % (طلب %)', old."status", new."status", old."id"
            using errcode = 'check_violation';
        end if;

        -- الإلغاءُ بعد الشحن: البضاعةُ خرجت، والطريقُ مرتجعٌ لا إلغاء.
        -- وهذا ثابتٌ **يعبر ثلاثة جداول**، ولا يعبّر عنه CHECK.
        if v_rule."requires_no_shipment" then
          select count(*) into v_shipped
            from "order_fulfillment" ofu
            join "fulfillment" f on f."id" = ofu."fulfillment_id"
           where ofu."order_id" = old."id"
             and f."shipped_at" is not null
             and f."canceled_at" is null;

          if v_shipped > 0 then
            raise exception
              'zadim: لا يُلغى طلبٌ شُحنت منه شحنة (طلب %، شحنات %)', old."id", v_shipped
              using errcode = 'check_violation';
          end if;
        end if;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_order_transition_trg" on "order";`);
    this.addSql(`
      create trigger "zadim_guard_order_transition_trg"
        before update of "status" on "order"
        for each row execute function "zadim_guard_order_transition"();
    `);

    // ── ٥) الحدثُ في نفس المعاملة ───────────────────────────────
    this.addSql(`
      create or replace function "zadim_emit_order_event"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_event text;
      begin
        if tg_op = 'INSERT' then
          v_event := 'OrderPlaced';
        elsif new."status" is distinct from old."status" then
          v_event := case new."status"::text
            when 'canceled'  then 'OrderCancelled'
            when 'completed' then 'OrderCompleted'
            else 'OrderStatusChanged'
          end;
        else
          return null;
        end if;

        insert into "zadim_outbox_event"
          ("id","event","aggregate_type","aggregate_id","payload","occurred_at")
        values (
          'evt_' || replace(gen_random_uuid()::text, '-', ''),
          v_event,
          'order',
          new."id",
          jsonb_build_object(
            'from', case when tg_op = 'INSERT' then null else old."status"::text end,
            'to',   new."status"::text,
            'display_id', new."display_id"
          ),
          now()
        );

        return null;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_emit_order_event_trg" on "order";`);
    this.addSql(`
      create trigger "zadim_emit_order_event_trg"
        after insert or update of "status" on "order"
        for each row execute function "zadim_emit_order_event"();
    `);

    // ── ٦) حرمةُ الفاتورة ───────────────────────────────────────
    this.addSql(`
      create or replace function "zadim_guard_invoice_line"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_order_id text;
        v_status   text;
      begin
        if new."unit_price" is not distinct from old."unit_price" then
          return new;
        end if;

        select oi."order_id", o."status"::text into v_order_id, v_status
          from "order_item" oi
          join "order" o on o."id" = oi."order_id"
         where oi."item_id" = old."id"
         limit 1;

        -- سطرٌ بلا طلب: بندُ سلّةٍ لم يصر فاتورةً بعد. لا شأنَ لنا به.
        if v_order_id is null then
          return new;
        end if;

        -- المُغلَقُ لا يُمسّ.
        if v_status in ('completed', 'canceled', 'archived') then
          raise exception
            'zadim: فاتورةُ طلبٍ % لا تُعدَّل (طلب %)', v_status, v_order_id
            using errcode = 'check_violation';
        end if;

        -- وما عداه يُسجَّل: التعديلُ مشروعٌ، والصمتُ عنه ليس كذلك.
        insert into "zadim_invoice_change"
          ("id","order_id","line_item_id","field","old_value","new_value","actor_id")
        values (
          'invch_' || replace(gen_random_uuid()::text, '-', ''),
          v_order_id, old."id", 'unit_price',
          old."unit_price"::text, new."unit_price"::text,
          nullif(current_setting('zadim.actor_id', true), '')
        );

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_invoice_line_trg" on "order_line_item";`);
    this.addSql(`
      create trigger "zadim_guard_invoice_line_trg"
        before update of "unit_price" on "order_line_item"
        for each row execute function "zadim_guard_invoice_line"();
    `);

    // ── ٧) المحورُ الماليّ: المستردُّ لا يتجاوز المحصَّل ─────────
    //
    // `03-state-machines.md` §٢ يطلب ثلاثةَ قيود `CHECK`. وهي **ليست
    // قيوداً ممكنة**: المبالغُ في ثلاثة جداول (`payment` · `capture` ·
    // `refund`)، والثابتُ مجموعٌ يعبرها. فالمُطلِقُ بديلُه الوحيد.
    //
    // ويُبنى اليوم لا يوم تصل المدفوعات: الجداولُ فارغةٌ الآن فالكلفةُ
    // صفر، ويوم تمتلئ يكون الحارسُ سابقاً للمال لا لاحقاً به.
    this.addSql(`
      create or replace function "zadim_guard_refund"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_captured numeric;
        v_refunded numeric;
      begin
        select coalesce(sum("amount"), 0) into v_captured
          from "capture" where "payment_id" = new."payment_id" and "deleted_at" is null;

        select coalesce(sum("amount"), 0) into v_refunded
          from "refund" where "payment_id" = new."payment_id" and "deleted_at" is null;

        if v_refunded > v_captured then
          raise exception
            'zadim: استردادٌ يتجاوز المحصَّل — المستردّ % والمحصَّل % (دفعة %)',
            v_refunded, v_captured, new."payment_id"
            using errcode = 'check_violation';
        end if;

        return null;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_refund_trg" on "refund";`);
    this.addSql(`
      create trigger "zadim_guard_refund_trg"
        after insert or update of "amount" on "refund"
        for each row execute function "zadim_guard_refund"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_trans','order','zadim_guard_order_transition_trg',
         'لا انتقالَ إلا وهو في جدول الانتقالات — والملغى لا يُحيا'),
        ('intg_evt','order','zadim_emit_order_event_trg',
         'الحدثُ يُكتب في نفس معاملة تغيّر الحالة — فإمّا أن يقعا معاً أو لا يقعا'),
        ('intg_inv','order_line_item','zadim_guard_invoice_line_trg',
         'فاتورةُ طلبٍ مُغلَقٍ لا تُعدَّل، وتعديلُ القائم يُسجَّل'),
        ('intg_refund','refund','zadim_guard_refund_trg',
         'المستردُّ لا يتجاوز المحصَّل — ثابتٌ يعبر ثلاثة جداول')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_guard_refund_trg" on "refund";`);
    this.addSql(`drop function if exists "zadim_guard_refund"();`);
    this.addSql(`drop trigger if exists "zadim_guard_invoice_line_trg" on "order_line_item";`);
    this.addSql(`drop function if exists "zadim_guard_invoice_line"();`);
    this.addSql(`drop trigger if exists "zadim_emit_order_event_trg" on "order";`);
    this.addSql(`drop function if exists "zadim_emit_order_event"();`);
    this.addSql(`drop trigger if exists "zadim_guard_order_transition_trg" on "order";`);
    this.addSql(`drop function if exists "zadim_guard_order_transition"();`);
    this.addSql(`delete from "zadim_integrity_check"
                  where "id" in ('intg_trans','intg_evt','intg_inv','intg_refund');`);
    this.addSql(`drop table if exists "zadim_invoice_change" cascade;`);
    this.addSql(`drop table if exists "zadim_outbox_event" cascade;`);
    this.addSql(`drop table if exists "zadim_order_transition" cascade;`);
  }
}
