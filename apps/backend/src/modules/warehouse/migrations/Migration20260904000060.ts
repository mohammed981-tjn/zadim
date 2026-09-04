import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * تسويةُ المخزون بموافقةٍ ثانية (البند ١٫٤).
 *
 * ── الثابتُ الذي تحرسه القاعدة ───────────────────────────────────
 *
 * «**لا أحدَ يوافق على تسويةِ نفسِه**، ولا يقع الأثرُ قبل الموافقة.»
 *
 * وهذا ثابتٌ لا يُترك لشرطِ `if` في خدمة: مسارُ التسوية سيُنادى من
 * لوحةٍ ومن سكربتِ استيرادٍ ومن مسارِ جردٍ لاحق، وشرطُ الخدمة يحرس
 * المسارَ الذي مرّ به وحدَه. **والمُطلِقُ يرى الكتابةَ من أيّ باب.**
 */
export class Migration20260904000060 extends Migration {
  async up(): Promise<void> {
    // ── ١) السياسة — حدٌّ بالكمّية وحدٌّ بالقيمة ────────────────
    this.addSql(`
      create table if not exists "zadim_adjustment_policy" (
        "id"                      text not null,
        "threshold_quantity"      integer not null default 10,
        "threshold_value_halalas" bigint  not null default 50000,
        "is_enabled"              boolean not null default true,
        "note"                    text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "zadim_adjustment_policy_pkey" primary key ("id"),
        constraint "zadim_adjustment_policy_qty_check"   check ("threshold_quantity" >= 0),
        constraint "zadim_adjustment_policy_value_check" check ("threshold_value_halalas" >= 0)
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_adjustment_policy_singleton"
        on "zadim_adjustment_policy" ((true)) where "deleted_at" is null;
    `);
    this.addSql(`
      insert into "zadim_adjustment_policy" ("id","threshold_quantity","threshold_value_halalas","note")
      values ('adjp_default', 10, 50000, 'سياسةُ البداية — يضبطها المالك من لوحته')
      on conflict do nothing;
    `);

    // ── ٢) التسوية ─────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_stock_adjustment" (
        "id"                text not null,
        "inventory_item_id" text not null,
        "location_id"       text not null,
        "delta"             integer not null,
        "reason"            text not null default 'adjustment',
        "state"             text not null default 'pending',
        "needs_approval"    boolean not null default true,
        "requested_by"      text not null,
        "approved_by"       text null,
        "applied_by"        text null,
        "approved_at"       timestamptz null,
        "applied_at"        timestamptz null,
        "value_halalas"     bigint null,
        "note"              text null,
        "reject_reason"     text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "zadim_stock_adjustment_pkey" primary key ("id"),
        -- تسويةٌ بفرقِ صفرٍ ليست تسوية (نفسُ حجّة دفتر الحركات).
        constraint "zadim_stock_adjustment_delta_check" check ("delta" <> 0),
        constraint "zadim_stock_adjustment_state_check"
          check ("state" in ('pending','approved','applied','rejected')),
        constraint "zadim_stock_adjustment_reason_check"
          check ("reason" in ('adjustment','stocktake','damage','correction')),

        -- 🔴 **جوهرُ البند كلِّه، وقيدٌ في القاعدة لا شرطٌ في خدمة**:
        -- لا أحدَ يوافق على تسويةِ نفسِه. وشرطُ الخدمة يحرس المسارَ
        -- الذي مرّ به وحدَه، والقيدُ يحرس الجدولَ من أيّ باب.
        constraint "zadim_stock_adjustment_two_eyes"
          check ("approved_by" is null or "approved_by" <> "requested_by")
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_stock_adjustment_state"
        on "zadim_stock_adjustment" ("state");
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_stock_adjustment_item"
        on "zadim_stock_adjustment" ("inventory_item_id", "location_id");
    `);

    // ── ٣) المُطلِقُ: لا تطبيقَ قبل الموافقة، ولا رجوعَ بعده ────
    this.addSql(`
      create or replace function "zadim_guard_stock_adjustment"()
      returns trigger language plpgsql as $$
      begin
        -- حالةٌ نهائيّةٌ لا تُحيا: المطبَّقُ والمرفوضُ تاريخٌ.
        if old."state" in ('applied','rejected') and new."state" <> old."state" then
          raise exception 'تسويةٌ %: حالةٌ نهائيّةٌ لا تُحيا (% ← %)',
            old."id", old."state", new."state";
        end if;

        -- 🔴 والأثرُ لا يقع قبل الموافقة الثانية.
        if new."state" = 'applied' and old."state" <> 'applied' then
          if new."needs_approval" and new."approved_by" is null then
            raise exception 'تسويةٌ % تجاوزت الحدَّ ولم يوافق عليها ثانٍ — لا تُطبَّق', old."id";
          end if;
          if new."applied_at" is null then
            new."applied_at" := now();
          end if;
        end if;

        if new."state" = 'approved' and old."state" <> 'approved' then
          if new."approved_by" is null then
            raise exception 'موافقةٌ بلا موافِق (%)', old."id";
          end if;
          if new."approved_at" is null then
            new."approved_at" := now();
          end if;
        end if;

        -- ⚠️ والكمّيةُ والموقعُ لا يُغيَّران بعد الطلب: من يوافق على
        -- «ثلاث قطع» يجب ألّا يجد نفسَه وافق على ثلاثمئة. وهذا أخطرُ
        -- التفافٍ على الموافقة الثانية، ولا يمنعه شرطُ «من وافق».
        if new."delta" <> old."delta"
           or new."inventory_item_id" <> old."inventory_item_id"
           or new."location_id" <> old."location_id" then
          raise exception 'تسويةٌ %: الكمّيةُ والصنفُ والموقعُ لا تُغيَّر بعد الطلب', old."id";
        end if;

        return new;
      end $$;
    `);
    this.addSql(`
      drop trigger if exists "zadim_guard_stock_adjustment_trg" on "zadim_stock_adjustment";
      create trigger "zadim_guard_stock_adjustment_trg"
        before update on "zadim_stock_adjustment"
        for each row execute function "zadim_guard_stock_adjustment"();
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_adj_two_eyes','zadim_stock_adjustment','zadim_stock_adjustment_two_eyes',
         'لا أحدَ يوافق على تسويةِ نفسِه — وتسويةٌ منفردة أسهلُ طريقةٍ لإخفاء سرقةٍ من المستودع'),
        ('intg_adj_effect','zadim_stock_adjustment','zadim_guard_stock_adjustment_trg',
         'لا أثرَ على الرصيد قبل الموافقة الثانية · والكمّيةُ لا تُغيَّر بعد الطلب')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`delete from "zadim_integrity_check" where "id" like 'intg_adj_%';`);
    this.addSql(`drop trigger if exists "zadim_guard_stock_adjustment_trg" on "zadim_stock_adjustment";`);
    this.addSql(`drop function if exists "zadim_guard_stock_adjustment"();`);
    this.addSql(`drop table if exists "zadim_stock_adjustment" cascade;`);
    this.addSql(`drop table if exists "zadim_adjustment_policy" cascade;`);
  }
}
