import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة bulk — الدفعاتُ وتراجعُها.
 *
 * ── ولا حدَّ للعدد هنا، وذلك مقصود ─────────────────────────────
 *
 * البوّابة تقول «الدفعةُ على **٥٠٠ صنف** قابلةٌ للتراجع» — وهو **حجمُ
 * الاختبار لا حدُّ النظام**. والحدُّ الحقيقيُّ موجودٌ منذ المرحلة ١:
 * `products.bulk_update` له سقفٌ في `zadim_role_limit` **يختلف بالدور**
 * ويضبطه المدير العام. وقيدٌ بـ٥٠٠ هنا يجعل للنظام حدّين يفترقان يومَ
 * يرفع المالكُ السقفَ لدورٍ واحد.
 */
export class Migration20260901000070 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_bulk_operation" (
        "id"             text not null,
        "kind"           text not null,
        "entity_type"    text not null,
        "status"         text not null default 'prepared',
        "item_count"     integer not null,
        "applied_count"  integer not null default 0,
        "reverted_count" integer not null default 0,
        "skipped_count"  integer not null default 0,
        "requested_by"   text null,
        "note"           text null,
        "applied_at"     timestamptz null,
        "reverted_at"    timestamptz null,
        "created_at"     timestamptz not null default now(),
        "updated_at"     timestamptz not null default now(),
        "deleted_at"     timestamptz null,
        constraint "zadim_bulk_operation_pkey" primary key ("id"),
        constraint "zadim_bulk_operation_status_check"
          check ("status" in ('prepared','applied','reverted','failed')),
        constraint "zadim_bulk_operation_counts_check" check (
          "item_count" >= 0 and "applied_count" >= 0 and
          "reverted_count" >= 0 and "skipped_count" >= 0 and
          "applied_count" <= "item_count" and
          "reverted_count" + "skipped_count" <= "item_count"
        ),
        -- «طُبّقت» تُلزم وقتَها، و«تُرووجع عنها» كذلك. وحالةٌ بلا وقتها
        -- تجعل «متى وقع هذا؟» سؤالاً بلا جواب في أخطر عمليةٍ في اللوحة.
        constraint "zadim_bulk_operation_applied_at_check"
          check ("status" <> 'applied' or "applied_at" is not null),
        constraint "zadim_bulk_operation_reverted_at_check"
          check ("status" <> 'reverted' or "reverted_at" is not null)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_bulk_operation_status"
        on "zadim_bulk_operation" (status) where deleted_at is null;
    `);

    this.addSql(`
      create table if not exists "zadim_bulk_change" (
        "id"                text not null,
        "bulk_operation_id" text not null,
        "entity_id"         text not null,
        "field"             text not null,
        "old_value"         text null,
        "new_value"         text null,
        "state"             text not null default 'prepared',
        "skip_reason"       text null,
        "created_at"        timestamptz not null default now(),
        "updated_at"        timestamptz not null default now(),
        "deleted_at"        timestamptz null,
        constraint "zadim_bulk_change_pkey" primary key ("id"),
        constraint "zadim_bulk_change_state_check"
          check ("state" in ('prepared','applied','reverted','skipped')),
        -- المتخطّى يُلزم سببَه: «لم يُعَد» بلا سببٍ يجعل المديرَ يظنّ
        -- التراجعَ ناقصاً بلا أن يعرف لماذا.
        constraint "zadim_bulk_change_skip_reason_check"
          check ("state" <> 'skipped' or "skip_reason" is not null)
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_bulk_change_operation"
        on "zadim_bulk_change" (bulk_operation_id) where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_bulk_change_entity"
        on "zadim_bulk_change" (entity_id) where deleted_at is null;
    `);

    // 🔴 القيمةُ القديمة تُكتب مرّةً ولا تُعدَّل بعدها. وتعديلُها يعني
    // تراجعاً يُعيد قيمةً لم تكن — وهو أسوأُ من ألّا يُتراجَع.
    this.addSql(`
      create or replace function "zadim_guard_bulk_change"()
      returns trigger
      language plpgsql
      as $$
      begin
        if new."old_value" is distinct from old."old_value"
           or new."new_value" is distinct from old."new_value"
           or new."entity_id" is distinct from old."entity_id"
           or new."field" is distinct from old."field" then
          raise exception
            'zadim: قيمةُ الدفعة لا تُعدَّل بعد التحضير (%)', old."id"
            using errcode = 'check_violation';
        end if;
        return new;
      end;
      $$;
    `);
    this.addSql(`drop trigger if exists "zadim_guard_bulk_change_trg" on "zadim_bulk_change";`);
    this.addSql(`
      create trigger "zadim_guard_bulk_change_trg"
        before update on "zadim_bulk_change"
        for each row execute function "zadim_guard_bulk_change"();
    `);
    this.addSql(`create or replace rule "zadim_bulk_change_no_delete" as
                 on delete to "zadim_bulk_change" do instead nothing;`);
    this.addSql(`create or replace rule "zadim_bulk_operation_no_delete" as
                 on delete to "zadim_bulk_operation" do instead nothing;`);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_bulk','zadim_bulk_change','zadim_guard_bulk_change_trg',
              'قيمةُ الدفعة القديمة تُكتب مرّةً — وتعديلُها يُنتج تراجعاً يُعيد قيمةً لم تكن')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop trigger if exists "zadim_guard_bulk_change_trg" on "zadim_bulk_change";`);
    this.addSql(`drop function if exists "zadim_guard_bulk_change"();`);
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_bulk';`);
    this.addSql(`drop table if exists "zadim_bulk_change" cascade;`);
    this.addSql(`drop table if exists "zadim_bulk_operation" cascade;`);
  }
}
