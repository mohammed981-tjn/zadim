import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * سياسةُ إعادة المحاولة (بند ٤٨: لا رقمَ عملٍ مبرمَج).
 *
 * وصفٌّ واحدٌ يحرسه فهرسٌ فريد: سياستان تعنيان سلوكاً يتبع أيَّهما قُرئ
 * أوّلاً، وهو أسوأُ من غياب السياسة لأنه يتغيّر بلا سبب ظاهر.
 */
export class Migration20260904000040 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_notify_policy" (
        "id"                  text not null,
        "max_attempts"        integer not null default 3,
        "retry_after_seconds" integer not null default 300,
        "is_enabled"          boolean not null default true,
        "note"                text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "zadim_notify_policy_pkey" primary key ("id"),
        constraint "zadim_notify_policy_attempts_check" check ("max_attempts" >= 1),
        constraint "zadim_notify_policy_delay_check"    check ("retry_after_seconds" >= 0)
      );
    `);

    this.addSql(`
      create unique index if not exists "IDX_zadim_notify_policy_singleton"
        on "zadim_notify_policy" ((true)) where "deleted_at" is null;
    `);

    // صفُّ البداية: ثلاثُ محاولاتٍ وخمسُ دقائق. والمالكُ يغيّرهما من
    // لوحته — ولا يُبرمَجان.
    this.addSql(`
      insert into "zadim_notify_policy" ("id","max_attempts","retry_after_seconds","note")
      values ('npol_default', 3, 300, 'سياسةُ البداية — تُضبط من لوحة الإدارة')
      on conflict do nothing;
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_notify_policy','zadim_notify_policy','IDX_zadim_notify_policy_singleton',
              'سياسةُ إعادةٍ واحدةٌ لا اثنتان — وإلا تبع السلوكُ أيَّهما قُرئ أوّلاً')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_notify_policy';`);
    this.addSql(`drop table if exists "zadim_notify_policy" cascade;`);
  }
}
