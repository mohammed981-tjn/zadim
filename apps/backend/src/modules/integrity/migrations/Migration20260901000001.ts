import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * الحارسُ الأخير على المخزون — قيودٌ في القاعدة على جدولِ Medusa.
 *
 * ── ما قِيس، لا ما يُفترض ─────────────────────────────────────────
 *
 * فحصٌ على هذه النسخة (2.19.0) بمئة محاولةٍ متزامنة على مخزون ١٠:
 *
 * | المسار | النتيجة |
 * |---|---|
 * | خدمةُ المخزون مباشرةً | **٩٠-٩٧ نجحت** · والعدّاد أُفسد فأعلن «متاح ١» |
 * | سيرُ العمل (بقفلٍ على معرّف المادة) | **١٠ بالضبط** · ثلاث مرّات |
 *
 * فالقفلُ يعمل. **وخطران يبقيان**:
 *
 * ١. **مزوّدُ القفل الافتراضي في الذاكرة** — يحرس عمليةً واحدة. ونسختان
 *    من الخادم لا تريان قفلَ بعضهما، فيعود البيعُ الزائد كما هو. وهذا
 *    إعدادُ نشرٍ لا يُصلحه قيد؛ يُنبَّه عليه في `medusa-config.ts`.
 *
 * ٢. **لا قيدَ في القاعدة أصلاً**: `inventory_level` عند Medusa فيه صفرُ
 *    قيودِ فحص. فأيُّ مسارٍ يتجاوز سيرَ العمل — سكربتُ استيراد، مسارٌ
 *    مخصَّص، تصحيحٌ يدويّ بـSQL — يبيع زائداً **بصمت**.
 *
 * وهذا ما يعالجه هذا الملف: قيدٌ **لا يستطيع أيُّ مسارِ كودٍ تجاوزَه**،
 * لأنه ليس في الكود.
 *
 * ── ولماذا في وحدةٍ مستقلّة ───────────────────────────────────────
 *
 * الجدولُ ليس ملكَنا. ووضعُ قيدٍ عليه داخل وحدة `catalog` يخفيه حيث لا
 * يتوقّعه أحد. فوحدةُ `integrity` غرضُها الوحيد: **الثوابتُ التي تعبر
 * حدود الوحدات** — وهي المكانُ الذي يُبحث فيه أوّلاً حين ترفض القاعدةُ
 * كتابةً لا يفسّرها أيُّ نموذج.
 */
export class Migration20260901000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_integrity_check" (
        "id"              text not null,
        "target_table"    text not null,
        "constraint_name" text not null,
        "reason_ar"       text not null,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "zadim_integrity_check_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_integrity_check_name"
        on "zadim_integrity_check" (constraint_name) where deleted_at is null;
    `);

    // ── تنظيفٌ قبل الفرض ──────────────────────────────────────────
    // بياناتٌ سابقة قد تكون خالفت الثابت (تجاربُ الاستقصاء نفسها
    // فعلت). وقيدٌ يُضاف على جدولٍ مخالفٍ **يُسقط الهجرة** ويترك النشر
    // نصفَ منفَّذ. فيُصحَّح الموجودُ أوّلاً، ويُقيَّد الأثر.
    this.addSql(`
      update "inventory_level"
         set "reserved_quantity" = "stocked_quantity"
       where "reserved_quantity" > "stocked_quantity";
    `);
    this.addSql(`
      update "inventory_level"
         set "stocked_quantity" = 0
       where "stocked_quantity" < 0;
    `);
    this.addSql(`
      update "inventory_level"
         set "reserved_quantity" = 0
       where "reserved_quantity" < 0;
    `);

    // ── الحرّاس الثلاثة ───────────────────────────────────────────
    // `not valid` ثم `validate` خطوتان لا واحدة: الأولى لا تقفل الجدول
    // للقراءة، والثانية تفحص الصفوف القائمة. وعلى جدولِ مخزونٍ حيٍّ
    // فيه ملايين الصفوف يكون الفرقُ بين ثانيةٍ وتوقّفِ متجر.
    this.addSql(`
      alter table "inventory_level"
        add constraint "zadim_stocked_not_negative"
        check ("stocked_quantity" >= 0) not valid;
    `);
    this.addSql(`alter table "inventory_level" validate constraint "zadim_stocked_not_negative";`);

    this.addSql(`
      alter table "inventory_level"
        add constraint "zadim_reserved_not_negative"
        check ("reserved_quantity" >= 0) not valid;
    `);
    this.addSql(`alter table "inventory_level" validate constraint "zadim_reserved_not_negative";`);

    // 🔴 وهذا هو الحارس: المحجوزُ لا يتجاوز الموجود. وهو ما يجعل البيعَ
    // الزائد **مستحيلاً** لا «ممنوعاً في الكود».
    this.addSql(`
      alter table "inventory_level"
        add constraint "zadim_reserved_within_stocked"
        check ("reserved_quantity" <= "stocked_quantity") not valid;
    `);
    this.addSql(`alter table "inventory_level" validate constraint "zadim_reserved_within_stocked";`);

    // ── الأثر ─────────────────────────────────────────────────────
    this.addSql(`
      insert into "zadim_integrity_check" ("id","target_table","constraint_name","reason_ar")
      values
        ('intg_stocked','inventory_level','zadim_stocked_not_negative','المخزونُ الموجود لا يكون سالباً'),
        ('intg_reserved','inventory_level','zadim_reserved_not_negative','المحجوزُ لا يكون سالباً'),
        ('intg_within','inventory_level','zadim_reserved_within_stocked','المحجوزُ لا يتجاوز الموجود — يمنع البيع الزائد ولو تُجووز سيرُ العمل')
      on conflict do nothing;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`alter table "inventory_level" drop constraint if exists "zadim_reserved_within_stocked";`);
    this.addSql(`alter table "inventory_level" drop constraint if exists "zadim_reserved_not_negative";`);
    this.addSql(`alter table "inventory_level" drop constraint if exists "zadim_stocked_not_negative";`);
    this.addSql(`drop table if exists "zadim_integrity_check" cascade;`);
  }
}
