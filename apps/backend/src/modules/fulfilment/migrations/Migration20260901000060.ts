import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة fulfilment — اللقطُ والتغليفُ والتتبّع.
 *
 * ── ثلاثةٌ لا تُكسر (`03-state-machines.md` §٣) ────────────────
 *
 * ١. **`picked` تشترط اكتمالَ اللقط.** بندٌ نقص ⇒ نقصٌ يُقيَّد ويُبلَّغ،
 *    **ولا تمرّ الشحنةُ صامتة**. وهذا ثابتٌ يعبر جدولين — قائمةً
 *    وبنودَها — فلا يعبّر عنه `CHECK`.
 * ٢. **الباركود يتحقّق ولا يثق**: مسحُ صنفٍ خطأ يوقف اللقط. والإيقافُ
 *    حالةٌ في القاعدة لا رسالةٌ في شاشة.
 * ٣. **التحصيل عند `shipped` وحده** — بُني في المرحلة ٦ (ADR-019).
 *
 * ── ولماذا جدولُ انتقالاتٍ ثانٍ ────────────────────────────────
 *
 * نفسُ نمط [ADR-016]: شاشةُ المستودع تبني أزرارَها من الجدول، وبعضُ
 * المتاجر تتخطّى خطوة. وخريطةٌ في الكود تعني **نشرةً لتغيير مسارِ عملٍ
 * داخل مستودع**.
 */
export class Migration20260901000060 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_pick_transition" (
        "id"                text not null,
        "from_state"        text not null,
        "to_state"          text not null,
        "requires_complete" boolean not null default false,
        "reason_ar"         text not null,
        "is_active"         boolean not null default true,
        "created_at"        timestamptz not null default now(),
        "updated_at"        timestamptz not null default now(),
        "deleted_at"        timestamptz null,
        constraint "zadim_pick_transition_pkey" primary key ("id"),
        constraint "zadim_pick_transition_not_self" check ("from_state" <> "to_state")
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_pick_transition_pair"
        on "zadim_pick_transition" (from_state, to_state) where deleted_at is null;
    `);
    this.addSql(`
      insert into "zadim_pick_transition"
        ("id","from_state","to_state","requires_complete","reason_ar")
      values
        ('ptrn_pe_pi','pending','picking',false,'بدأ الملقّط'),
        ('ptrn_pe_ca','pending','cancelled',false,'أُلغيت قبل أن تبدأ'),
        ('ptrn_pi_pk','picking','picked',true,'اكتمل اللقط — ولا تمرّ ناقصة'),
        ('ptrn_pi_bl','picking','blocked',false,'باركودٌ خارج القائمة أوقف اللقط'),
        ('ptrn_pi_ca','picking','cancelled',false,'أُلغيت أثناء اللقط'),
        ('ptrn_bl_pi','blocked','picking',false,'رُوجع الرفُّ واستُؤنف'),
        ('ptrn_bl_ca','blocked','cancelled',false,'تعذّرت فأُلغيت')
      on conflict do nothing;
    `);

    this.addSql(`
      create table if not exists "zadim_pick_list" (
        "id"             text not null,
        "fulfillment_id" text null,
        "order_id"       text null,
        "location_id"    text not null,
        "state"          text not null default 'pending',
        "assigned_to"    text null,
        "blocked_reason" text null,
        "created_at"     timestamptz not null default now(),
        "updated_at"     timestamptz not null default now(),
        "deleted_at"     timestamptz null,
        constraint "zadim_pick_list_pkey" primary key ("id"),
        constraint "zadim_pick_list_state_check"
          check ("state" in ('pending','picking','picked','blocked','cancelled')),
        -- حالةُ التوقّف تُلزم سببَها: «متوقّفة» بلا سببٍ تجعل الملقّطَ
        -- ينظر إلى شاشةٍ لا تقول له ماذا يفعل.
        constraint "zadim_pick_list_blocked_reason_check"
          check ("state" <> 'blocked' or "blocked_reason" is not null)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_pick_list_state"
        on "zadim_pick_list" (state) where deleted_at is null;
    `);

    this.addSql(`
      create table if not exists "zadim_pick_list_item" (
        "id"                text not null,
        "pick_list_id"      text not null,
        "inventory_item_id" text null,
        "variant_id"        text null,
        "title"             text not null,
        "sku"               text null,
        "barcode"           text null,
        "quantity"          integer not null,
        "picked_quantity"   integer not null default 0,
        "bin_location"      text null,
        "walk_order"        integer not null default 0,
        "created_at"        timestamptz not null default now(),
        "updated_at"        timestamptz not null default now(),
        "deleted_at"        timestamptz null,
        constraint "zadim_pick_list_item_pkey" primary key ("id"),
        constraint "zadim_pick_list_item_qty_check" check ("quantity" > 0),
        -- 🔴 لا يُلقط أكثرُ مما طُلب. وزيادةٌ هنا تعني طرداً فيه صنفٌ
        -- زائدٌ ومخزوناً ينقص بلا سبب — خطأٌ يُكتشف بعد شهرٍ في الجرد.
        constraint "zadim_pick_list_item_picked_check"
          check ("picked_quantity" >= 0 and "picked_quantity" <= "quantity")
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_pick_list_item_list"
        on "zadim_pick_list_item" (pick_list_id) where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_pick_list_item_barcode"
        on "zadim_pick_list_item" (barcode) where deleted_at is null;
    `);

    this.addSql(`
      create table if not exists "zadim_parcel" (
        "id"             text not null,
        "fulfillment_id" text null,
        "pick_list_id"   text null,
        "barcode"        text not null,
        "weight_grams"   integer not null,
        "length_mm"      integer null,
        "width_mm"       integer null,
        "height_mm"      integer null,
        "packed_by"      text null,
        "created_at"     timestamptz not null default now(),
        "updated_at"     timestamptz not null default now(),
        "deleted_at"     timestamptz null,
        constraint "zadim_parcel_pkey" primary key ("id"),
        -- الوزنُ إلزاميٌّ وموجب: الناقلُ يسعّر به، وطردٌ بوزنٍ صفرٍ يُردّ
        -- عند إصدار البوليصة **بعد أن يكون قد أُغلق**.
        constraint "zadim_parcel_weight_check" check ("weight_grams" > 0)
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_parcel_barcode"
        on "zadim_parcel" (barcode);
    `);

    this.addSql(`
      create table if not exists "zadim_shipment_event" (
        "id"              text not null,
        "fulfillment_id"  text null,
        "tracking_number" text null,
        "carrier_id"      text null,
        "code"            text not null,
        "description_ar"  text null,
        "occurred_at"     timestamptz not null,
        "raw"             jsonb null,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "zadim_shipment_event_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_shipment_event_fulfillment"
        on "zadim_shipment_event" (fulfillment_id);
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_shipment_event_tracking"
        on "zadim_shipment_event" (tracking_number);
    `);
    // العميلُ قرأ هذه السطور. وتاريخُ شحنةٍ يتغيّر بعد أن رآه صاحبُه
    // أسوأُ من ألّا يُعرض.
    this.addSql(`create or replace rule "zadim_shipment_event_no_update" as
                 on update to "zadim_shipment_event" do instead nothing;`);
    this.addSql(`create or replace rule "zadim_shipment_event_no_delete" as
                 on delete to "zadim_shipment_event" do instead nothing;`);

    // ── 🔴 «لا تمرّ الشحنةُ ناقصةً» ─────────────────────────────
    this.addSql(`
      create or replace function "zadim_guard_pick_transition"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_rule record;
        v_missing int;
      begin
        if new."state" is not distinct from old."state" then
          return new;
        end if;

        select * into v_rule
          from "zadim_pick_transition"
         where "from_state" = old."state"
           and "to_state" = new."state"
           and "is_active"
           and "deleted_at" is null;

        if not found then
          raise exception
            'zadim: انتقالٌ ممنوع في اللقط % ⇐ % (قائمة %)', old."state", new."state", old."id"
            using errcode = 'check_violation';
        end if;

        if v_rule."requires_complete" then
          select count(*) into v_missing
            from "zadim_pick_list_item"
           where "pick_list_id" = old."id"
             and "deleted_at" is null
             and "picked_quantity" < "quantity";

          if v_missing > 0 then
            raise exception
              'zadim: اللقطُ ناقصٌ في % بنداً — تُقيَّد ويُبلَّغ، ولا تمرّ الشحنةُ صامتة', v_missing
              using errcode = 'check_violation';
          end if;
        end if;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_pick_transition_trg" on "zadim_pick_list";`);
    this.addSql(`
      create trigger "zadim_guard_pick_transition_trg"
        before update of "state" on "zadim_pick_list"
        for each row execute function "zadim_guard_pick_transition"();
    `);

    // ── وقائمةٌ متوقّفةٌ لا يُلقط فيها ─────────────────────────
    this.addSql(`
      create or replace function "zadim_guard_pick_item"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_state text;
      begin
        if new."picked_quantity" is not distinct from old."picked_quantity" then
          return new;
        end if;

        select "state" into v_state
          from "zadim_pick_list" where "id" = new."pick_list_id";

        -- الإيقافُ يعني «توقّف وراجع الرفّ». وسماحُ اللقط بعده يجعله
        -- تحذيراً يُتجاهَل بدل أن يكون إيقافاً.
        if v_state in ('blocked', 'picked', 'cancelled') then
          raise exception
            'zadim: لا لقطَ في قائمةٍ حالُها % (قائمة %)', v_state, new."pick_list_id"
            using errcode = 'check_violation';
        end if;

        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_pick_item_trg" on "zadim_pick_list_item";`);
    this.addSql(`
      create trigger "zadim_guard_pick_item_trg"
        before update of "picked_quantity" on "zadim_pick_list_item"
        for each row execute function "zadim_guard_pick_item"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_pick','zadim_pick_list','zadim_guard_pick_transition_trg',
         'اللقطُ لا يُختم ناقصاً — والنقصُ يُقيَّد ويُبلَّغ'),
        ('intg_pick_item','zadim_pick_list_item','zadim_guard_pick_item_trg',
         'قائمةٌ أوقفها باركودٌ خاطئ لا يُلقط فيها حتى تُراجَع')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_guard_pick_item_trg" on "zadim_pick_list_item";`);
    this.addSql(`drop function if exists "zadim_guard_pick_item"();`);
    this.addSql(`drop trigger if exists "zadim_guard_pick_transition_trg" on "zadim_pick_list";`);
    this.addSql(`drop function if exists "zadim_guard_pick_transition"();`);
    this.addSql(`delete from "zadim_integrity_check" where "id" in ('intg_pick','intg_pick_item');`);
    this.addSql(`drop table if exists "zadim_shipment_event" cascade;`);
    this.addSql(`drop table if exists "zadim_parcel" cascade;`);
    this.addSql(`drop table if exists "zadim_pick_list_item" cascade;`);
    this.addSql(`drop table if exists "zadim_pick_list" cascade;`);
    this.addSql(`drop table if exists "zadim_pick_transition" cascade;`);
  }
}
