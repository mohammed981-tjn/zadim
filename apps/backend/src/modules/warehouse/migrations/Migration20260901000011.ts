import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * موقعُ الحجر — العمودُ الذي تقف عليه بوّابةُ المرحلة ١٠.
 *
 * ولماذا عمودٌ ثانٍ ولا يكفي `is_fulfilment_enabled`: مشروحٌ في
 * `models/location-profile.ts`. وخلاصتُه أن «موقوفٌ مؤقّتاً» تُطفأ
 * بنقرةِ صباح، و«هنا يقف الراجعُ حتى يُفحص» لا يجوز أن تُطفأ بها.
 */
export class Migration20260901000011 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "zadim_location_profile"
        add column if not exists "is_returns_location" boolean not null default false;
    `);

    this.addSql(`
      create index if not exists "IDX_zadim_location_profile_returns"
        on "zadim_location_profile" ("is_returns_location");
    `);

    // ⚠️ **موقعٌ واحدٌ لا يكون رفّاً وحجراً معاً.**
    //
    // لو جاز ذلك لصار الراجعُ في نفس المستودع الذي يُشحن منه، وحارسُ
    // «لا يعود إلى الرفّ آلياً» بلا معنى: هو **على الرفّ** فعلاً لحظةَ
    // استلامه. والقيدُ يمنع الحالةَ من الوجود بدل أن يُفحص عنها.
    this.addSql(`
      alter table "zadim_location_profile"
        drop constraint if exists "zadim_location_profile_returns_check";
    `);
    this.addSql(`
      alter table "zadim_location_profile"
        add constraint "zadim_location_profile_returns_check"
        check (not ("is_returns_location" and "is_fulfilment_enabled"));
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table "zadim_location_profile"
        drop constraint if exists "zadim_location_profile_returns_check";
    `);
    this.addSql(`
      alter table "zadim_location_profile" drop column if exists "is_returns_location";
    `);
  }
}
