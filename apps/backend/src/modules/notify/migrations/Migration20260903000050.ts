import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * إلغاءُ الاشتراك (بند ٤٣) — يصل **مع** المزوّد لا بعده.
 *
 * فاليومُ الذي يبدأ فيه الإرسالُ الفعليّ هو اليومُ الذي يجب أن يعمل فيه
 * الإلغاء. ورسائلُ تسويقٍ بلا مخرجٍ تعني شكاوى، ثم حظرَ نطاقِ المتجر
 * عند مزوّدي البريد — **وذلك لا يُستدرَك بإصلاحِ كود**.
 */
export class Migration20260903000050 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_notification_optout" (
        "id"         text not null,
        "channel"    text not null,
        "recipient"  text not null,
        "reason"     text not null default 'requested',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "zadim_notification_optout_pkey" primary key ("id")
      );
    `);

    // 🔴 فريدٌ لا «اقرأ ثمّ اكتب»: ضغطتان على رابط الإلغاء تصلان معاً.
    this.addSql(`
      create unique index if not exists "IDX_zadim_notification_optout_unique"
        on "zadim_notification_optout" ("channel", "recipient")
        where "deleted_at" is null;
    `);

    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values ('intg_optout','zadim_notification_optout','IDX_zadim_notification_optout_unique',
              'إلغاءٌ واحدٌ لكل (قناة · مستقبِل) — والإلغاءُ يُفحص قبل الحجز فلا يبقى صفٌّ ينتظر إلى الأبد')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`delete from "zadim_integrity_check" where "id" = 'intg_optout';`);
    this.addSql(`drop table if exists "zadim_notification_optout" cascade;`);
  }
}
