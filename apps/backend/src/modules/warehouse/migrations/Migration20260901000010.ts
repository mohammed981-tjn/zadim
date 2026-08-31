import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة warehouse — ملفُّ المستودع، ودفترُ الحركات، وقواعدُ التنبيه.
 *
 * ومكتوبةٌ بخطّ اليد للسببين المعروفين (انظر هجرةَ `access`)، وثالثٍ
 * يخصُّ هذه: **دفترُ الحركات يكتبه مُطلِقٌ لا كود**، والمولّدُ لا يعرف
 * مُطلِقات.
 *
 * ── لماذا المُطلِق ───────────────────────────────────────────────
 *
 * دفترٌ يكتبه التطبيقُ ينقص كلَّما نُسي نداؤه، ونقصُه لا يظهر: الرصيدُ
 * صحيحٌ والدفترُ ناقص، فيبدو جوابُ «من أين نقصت هذه الثلاثون؟» كاملاً
 * وهو ناقص. والمُطلِقُ يرى **كلَّ** كتابةٍ على `inventory_level` مهما
 * كان مصدرُها — سيرُ عملٍ، أو سكربتُ استيراد، أو `psql` بيدِ مشغّل.
 */
export class Migration20260901000010 extends Migration {
  async up(): Promise<void> {
    // ── ملفُّ المستودع ───────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_location_profile" (
        "id"                     text not null,
        "location_id"            text not null,
        "city"                   text null,
        "region_code"            text null,
        "priority"               integer not null default 0,
        "is_fulfilment_enabled"  boolean not null default true,
        "display_name_ar"        text null,
        "created_at"             timestamptz not null default now(),
        "updated_at"             timestamptz not null default now(),
        "deleted_at"             timestamptz null,
        constraint "zadim_location_profile_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_location_profile_location_unique"
        on "zadim_location_profile" (location_id) where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_location_profile_city"
        on "zadim_location_profile" (city) where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_location_profile_priority"
        on "zadim_location_profile" (priority) where deleted_at is null;
    `);

    // ── قواعدُ التنبيه ───────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_stock_alert_rule" (
        "id"                  text not null,
        "scope"               text not null,
        "inventory_item_id"   text null,
        "location_id"         text null,
        "threshold_quantity"  integer not null,
        "is_active"           boolean not null default true,
        "note"                text null,
        "created_at"          timestamptz not null default now(),
        "updated_at"          timestamptz not null default now(),
        "deleted_at"          timestamptz null,
        constraint "zadim_stock_alert_rule_pkey" primary key ("id"),
        constraint "zadim_stock_alert_rule_scope_check"
          check ("scope" in ('global','item','location','item_location')),
        -- النطاقُ يُلزم حقولَه: قاعدةُ \`item\` بلا مادّةٍ تنطبق على كل
        -- شيءٍ صامتةً — وحدٌّ يُطبَّق حيث لم يُقصد أسوأُ من غيابه.
        constraint "zadim_stock_alert_rule_scope_fields_check" check (
          (scope = 'global'        and inventory_item_id is null and location_id is null) or
          (scope = 'item'          and inventory_item_id is not null and location_id is null) or
          (scope = 'location'      and inventory_item_id is null and location_id is not null) or
          (scope = 'item_location' and inventory_item_id is not null and location_id is not null)
        ),
        constraint "zadim_stock_alert_rule_threshold_check"
          check ("threshold_quantity" >= 0)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_stock_alert_rule_scope"
        on "zadim_stock_alert_rule" (scope, inventory_item_id, location_id) where deleted_at is null;
    `);
    // قاعدةٌ واحدةٌ نشطةٌ لكل نطاق: نسختان بحدّين مختلفين تجعلان
    // التنبيهَ يعتمد على أيِّهما قُرئت أوّلاً.
    this.addSql(`
      create unique index if not exists "IDX_zadim_stock_alert_rule_global_unique"
        on "zadim_stock_alert_rule" (scope) where scope = 'global' and is_active and deleted_at is null;
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_stock_alert_rule_scoped_unique"
        on "zadim_stock_alert_rule" (scope, coalesce(inventory_item_id,''), coalesce(location_id,''))
        where scope <> 'global' and is_active and deleted_at is null;
    `);

    // ── دفترُ الحركات ────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_stock_movement" (
        "id"                 text not null,
        "inventory_item_id"  text not null,
        "location_id"        text not null,
        "delta"              integer not null,
        "balance_after"      integer not null,
        "reason"             text not null default 'adjustment',
        "reference_type"     text null,
        "reference_id"       text null,
        "actor_id"           text null,
        "note"               text null,
        "created_at"         timestamptz not null default now(),
        "updated_at"         timestamptz not null default now(),
        "deleted_at"         timestamptz null,
        constraint "zadim_stock_movement_pkey" primary key ("id"),
        constraint "zadim_stock_movement_reason_check" check ("reason" in (
          'receipt','adjustment','stocktake','fulfilment','return',
          'transfer_in','transfer_out','damage','correction'
        )),
        -- حركةٌ بفرقٍ صفرٍ ليست حركة. ولو سُمح بها لامتلأ الدفترُ بضجيجٍ
        -- يُخفي الحركاتِ الحقيقية.
        constraint "zadim_stock_movement_delta_check" check ("delta" <> 0)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_stock_movement_item_location"
        on "zadim_stock_movement" (inventory_item_id, location_id);
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_stock_movement_created"
        on "zadim_stock_movement" (created_at);
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_stock_movement_reference"
        on "zadim_stock_movement" (reference_type, reference_id);
    `);

    // ── الدفترُ يُلحَق ولا يُمسّ ─────────────────────────────────
    // `DO INSTEAD NOTHING` لا `raise`: الرفعُ يُسقط معاملةَ من حاول،
    // وقد يكون Medusa نفسَه في مسارٍ لا نتحكّم فيه. والمطلوبُ ألّا
    // يتغيّر السطر، لا أن يتوقّف المتجر.
    this.addSql(`create or replace rule "zadim_stock_movement_no_update" as
                 on update to "zadim_stock_movement" do instead nothing;`);
    this.addSql(`create or replace rule "zadim_stock_movement_no_delete" as
                 on delete to "zadim_stock_movement" do instead nothing;`);

    // ── المُطلِق: كلُّ تغيّرٍ في الموجود يُقيَّد ──────────────────
    this.addSql(`
      create or replace function "zadim_record_stock_movement"()
      returns trigger
      language plpgsql
      as $$
      declare
        v_delta   integer;
        v_reason  text;
        v_allowed text[] := array['receipt','adjustment','stocktake','fulfilment','return',
                                  'transfer_in','transfer_out','damage','correction'];
      begin
        if tg_op = 'INSERT' then
          v_delta := coalesce(new."stocked_quantity", 0);
        else
          v_delta := coalesce(new."stocked_quantity", 0) - coalesce(old."stocked_quantity", 0);
        end if;

        -- الحجزُ ليس حركةَ مخزون: الرفُّ لم يتغيّر. وصفوفُ
        -- \`reservation_item\` هي سجلُّ الحجز، وخلطُهما في دفترٍ واحد
        -- يجعل «كم دخل وكم خرج» سؤالاً بلا جواب.
        if v_delta = 0 then
          return null;
        end if;

        -- النيّةُ لا يراها المُطلِق: يقرأها من متغيّر الجلسة إن ضبطه
        -- الكودُ داخل معاملته. والمجهولُ **يُسجَّل ولا يُسقط الحركة** —
        -- الحركةُ أثمنُ من وصفها.
        v_reason := nullif(current_setting('zadim.movement_reason', true), '');
        if v_reason is null or not (v_reason = any(v_allowed)) then
          v_reason := case when tg_op = 'INSERT' then 'receipt' else 'adjustment' end;
        end if;

        insert into "zadim_stock_movement" (
          "id","inventory_item_id","location_id","delta","balance_after",
          "reason","reference_type","reference_id","actor_id"
        ) values (
          'smov_' || replace(gen_random_uuid()::text, '-', ''),
          new."inventory_item_id",
          new."location_id",
          v_delta,
          coalesce(new."stocked_quantity", 0),
          v_reason,
          nullif(current_setting('zadim.movement_reference_type', true), ''),
          nullif(current_setting('zadim.movement_reference_id', true), ''),
          nullif(current_setting('zadim.movement_actor_id', true), '')
        );

        return null;
      end;
      $$;
    `);

    this.addSql(`drop trigger if exists "zadim_record_stock_movement_trg" on "inventory_level";`);
    this.addSql(`
      create trigger "zadim_record_stock_movement_trg"
        after insert or update of "stocked_quantity"
        on "inventory_level"
        for each row
        execute function "zadim_record_stock_movement"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_ledger','inventory_level','zadim_record_stock_movement_trg',
              'كلُّ تغيّرٍ في الموجود يُقيَّد في دفتر الحركات — لا يتجاوزه مسارُ كودٍ لأنه ليس في الكود')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_record_stock_movement_trg" on "inventory_level";`);
    this.addSql(`drop function if exists "zadim_record_stock_movement"();`);
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_ledger';`);
    this.addSql(`drop table if exists "zadim_stock_movement" cascade;`);
    this.addSql(`drop table if exists "zadim_stock_alert_rule" cascade;`);
    this.addSql(`drop table if exists "zadim_location_profile" cascade;`);
  }
}
