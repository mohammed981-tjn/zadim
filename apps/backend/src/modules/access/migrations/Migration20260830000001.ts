import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة access — الجداول الخمسة: الصلاحيات والأدوار وحدودُها وإسنادُها
 * وسجلُّ التدقيق (بندا ٤٥ و٤٦).
 *
 * ⚠️ مكتوبةٌ بخطّ اليد لا بـ`medusa db:generate`. والسببُ اثنان:
 *  ١. مولّدُ Medusa 2.19 يسقط على الوحدات المحلية
 *     (`Unable to resolve the migration scripts` — مسارُ الاكتشاف
 *     `undefined` حين تُمرَّر صادراتُ الوحدة بدل مسارها).
 *  ٢. **والأهمّ**: قاعدةُ «سجلّ التدقيق يُلحَق ولا يُعدَّل ولا يُحذف»
 *     لا يعرفها المولّد أصلاً — وهي حارسٌ في القاعدة لا في الكود.
 *
 * ومقاييسُ الأعمدة تتبع اصطلاح Medusa: `text` للمعرّفات،
 * و`timestamptz` بـ`now()`، و`deleted_at` للحذف الناعم.
 */
export class Migration20260830000001 extends Migration {
  async up(): Promise<void> {
    // ── الصلاحيات ────────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_permission" (
        "id"          text not null,
        "slug"        text not null,
        "domain"      text not null,
        "description" text not null,
        "created_at"  timestamptz not null default now(),
        "updated_at"  timestamptz not null default now(),
        "deleted_at"  timestamptz null,
        constraint "zadim_permission_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_permission_slug_unique"
        on "zadim_permission" (slug) where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_permission_domain"
        on "zadim_permission" (domain) where deleted_at is null;
    `);

    // ── الأدوار ──────────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_role" (
        "id"         text not null,
        "slug"       text not null,
        "name_ar"    text not null,
        "is_system"  boolean not null default false,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "zadim_role_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_role_slug_unique"
        on "zadim_role" (slug) where deleted_at is null;
    `);

    // ── الدور × الصلاحية ─────────────────────────────────────────
    // ⚠️ أسماءُ الأعمدة تتبع **اسمَ الكيان** لا اسمَ الجدول المختصر:
    // ZadimRole ⇒ `zadim_role_id`. وتسميتُها `role_id` تُنتج
    // «column zadim_role_id does not exist» عند أول إسنادٍ لصلاحية —
    // عطلٌ لا يظهر في الهجرة بل في أول كتابة.
    this.addSql(`
      create table if not exists "zadim_role_permission" (
        "zadim_role_id"       text not null,
        "zadim_permission_id" text not null,
        constraint "zadim_role_permission_pkey"
          primary key ("zadim_role_id", "zadim_permission_id"),
        constraint "zadim_role_permission_role_fk"
          foreign key ("zadim_role_id") references "zadim_role" ("id") on update cascade on delete cascade,
        constraint "zadim_role_permission_permission_fk"
          foreign key ("zadim_permission_id") references "zadim_permission" ("id") on update cascade on delete cascade
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_role_permission_permission"
        on "zadim_role_permission" ("zadim_permission_id");
    `);

    // ── حدودُ الدور ──────────────────────────────────────────────
    // max_amount هللاتٌ صحيحة (ADR-008): numeric بلا كسورٍ لا float.
    // والفرقُ ليس أناقة — 0.1 + 0.2 ≠ 0.3 في العشريّ الثنائي، والخطأ
    // يظهر في تسوية آخر الشهر لا في الاختبار.
    this.addSql(`
      create table if not exists "zadim_role_limit" (
        "id"                       text not null,
        "role_id"                  text not null,
        "permission_slug"          text not null,
        "max_amount"               numeric null,
        "raw_max_amount"           jsonb null,
        "max_count"                integer null,
        "requires_second_approval" boolean not null default false,
        "created_at"               timestamptz not null default now(),
        "updated_at"               timestamptz not null default now(),
        "deleted_at"               timestamptz null,
        constraint "zadim_role_limit_pkey" primary key ("id"),
        constraint "zadim_role_limit_role_fk"
          foreign key ("role_id") references "zadim_role" ("id") on update cascade on delete cascade,
        constraint "zadim_role_limit_amount_not_negative"
          check ("max_amount" is null or "max_amount" >= 0),
        constraint "zadim_role_limit_count_positive"
          check ("max_count" is null or "max_count" > 0)
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_role_limit_unique"
        on "zadim_role_limit" (role_id, permission_slug) where deleted_at is null;
    `);

    // ── إسنادُ الدور للمستخدم ────────────────────────────────────
    // لا مفتاحَ أجنبيّ على user_id: الربطُ عبر حدود الوحدات في
    // Medusa v2 يكون بـ Module Link لا بـ FK.
    this.addSql(`
      create table if not exists "zadim_user_role" (
        "id"         text not null,
        "user_id"    text not null,
        "role_id"    text not null,
        "vendor_id"  text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "zadim_user_role_pkey" primary key ("id"),
        constraint "zadim_user_role_role_fk"
          foreign key ("role_id") references "zadim_role" ("id") on update cascade on delete cascade
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_user_role_unique"
        on "zadim_user_role" (user_id, role_id) where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_user_role_user"
        on "zadim_user_role" (user_id) where deleted_at is null;
    `);

    // ── سجلّ التدقيق ─────────────────────────────────────────────
    this.addSql(`
      create table if not exists "zadim_audit_log" (
        "id"          text not null,
        "actor_id"    text null,
        "actor_label" text not null,
        "action"      text not null,
        "entity"      text not null,
        "entity_id"   text not null,
        "old_value"   jsonb null,
        "new_value"   jsonb null,
        "ip"          text null,
        "user_agent"  text null,
        "created_at"  timestamptz not null default now(),
        "updated_at"  timestamptz not null default now(),
        "deleted_at"  timestamptz null,
        constraint "zadim_audit_log_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_audit_log_entity"
        on "zadim_audit_log" (entity, entity_id, created_at desc);
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_audit_log_actor"
        on "zadim_audit_log" (actor_id, created_at desc);
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_audit_log_action"
        on "zadim_audit_log" (action, created_at desc);
    `);

    // 🔴 الحارس: يُلحَق ولا يُعدَّل ولا يُحذف.
    //
    // سجلُّ تدقيقٍ يمكن تعديلُه ليس سجلَّ تدقيق. والحمايةُ هنا في
    // القاعدة لا في التطبيق عمداً: من يملك اتصالاً بالقاعدة — مبرمجاً
    // كان أو مهاجماً بلغ هذا الحدّ — لا يستطيع محوَ أثره.
    //
    // و`DO INSTEAD NOTHING` تبتلع النداء صامتاً، فالخدمة ترمي صراحةً
    // فوقها (service.ts) كي يعرف المبرمجُ خطأه في الاختبار لا بعد سنة.
    this.addSql(`
      create rule "zadim_audit_log_no_update" as
        on update to "zadim_audit_log" do instead nothing;
    `);
    this.addSql(`
      create rule "zadim_audit_log_no_delete" as
        on delete to "zadim_audit_log" do instead nothing;
    `);
  }

  async down(): Promise<void> {
    // القواعدُ أولاً: جدولٌ عليه rule لا يُسقَط قبل إسقاطها.
    this.addSql(`drop rule if exists "zadim_audit_log_no_update" on "zadim_audit_log";`);
    this.addSql(`drop rule if exists "zadim_audit_log_no_delete" on "zadim_audit_log";`);

    this.addSql(`drop table if exists "zadim_audit_log" cascade;`);
    this.addSql(`drop table if exists "zadim_user_role" cascade;`);
    this.addSql(`drop table if exists "zadim_role_limit" cascade;`);
    this.addSql(`drop table if exists "zadim_role_permission" cascade;`);
    this.addSql(`drop table if exists "zadim_role" cascade;`);
    this.addSql(`drop table if exists "zadim_permission" cascade;`);
  }
}
