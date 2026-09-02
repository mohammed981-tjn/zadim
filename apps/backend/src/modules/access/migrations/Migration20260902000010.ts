import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * تحديدُ معدّل النداءات (المرحلة ١٥). بخطّ اليد — المولّد يسقط على
 * الوحدات المحلية في 2.19.0 (ADR-001).
 */
export class Migration20260902000010 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_rate_limit_policy" (
        "id"             text not null,
        "name"           text not null,
        "path_prefix"    text not null,
        "methods"        text not null default '*',
        "window_seconds" integer not null,
        "max_requests"   integer not null,
        "scope_by"       text not null default 'ip',
        "enabled"        boolean not null default true,
        "created_at"     timestamptz not null default now(),
        "updated_at"     timestamptz not null default now(),
        "deleted_at"     timestamptz null,
        constraint "zadim_rate_limit_policy_pkey" primary key ("id"),

        -- المسارُ سابقةٌ تبدأ بـ\`/\`. وسابقةٌ فارغةٌ تحكم كلَّ نداءٍ في
        -- المتجر — وهو أسرعُ طريقٍ لإسقاطه بصفٍّ واحدٍ في اللوحة.
        constraint "zadim_rlp_path_check" check ("path_prefix" ~ '^/[a-zA-Z0-9/_-]*$'),

        -- 🔴 نافذةٌ صفريّةٌ = قسمةٌ على صفرٍ في محاذاة النافذة، وحدٌّ
        -- صفريٌّ = متجرٌ يرفض كلَّ نداء. كلاهما يُكتب بخطأٍ مطبعيّ في
        -- حقلٍ في اللوحة، وكلاهما يُسقط المتجر — فيُمنعان في القاعدة
        -- لا في نموذج الشاشة: الشاشةُ بابٌ واحد، والقاعدةُ كلُّ باب.
        constraint "zadim_rlp_window_check" check ("window_seconds" between 1 and 86400),
        constraint "zadim_rlp_max_check" check ("max_requests" between 1 and 1000000),

        constraint "zadim_rlp_scope_check" check ("scope_by" in ('ip', 'actor', 'ip_actor'))
      );
    `);

    // اسمٌ فريدٌ بين الأحياء: العدّاداتُ تُفتَّش باسم السياسة، فاسمان
    // متطابقان يجعلان سياستين تتقاسمان عدّاداً واحداً — أضيقُهما
    // يحكم، والأخرى موجودةٌ في اللوحة بلا أثر.
    this.addSql(`
      create unique index if not exists "IDX_zadim_rlp_name_unique"
        on "zadim_rate_limit_policy" ("name") where "deleted_at" is null;
    `);

    this.addSql(`
      create table if not exists "zadim_rate_limit_counter" (
        "id"           text not null,
        "policy_name"  text not null,
        "scope_key"    text not null,
        "window_start" timestamptz not null,
        "expires_at"   timestamptz not null,
        "count"        integer not null default 0,
        "created_at"   timestamptz not null default now(),
        "updated_at"   timestamptz not null default now(),
        "deleted_at"   timestamptz null,
        constraint "zadim_rlc_pkey" primary key ("id"),

        -- عدّادٌ سالبٌ لا يقع بمنطقنا، ويقع بـ\`update\` يدويّ. والقيدُ
        -- يجعل التصحيحَ الخاطئ خطأً وقتَ الكتابة لا حدّاً ينفتح صامتاً.
        constraint "zadim_rlc_count_check" check ("count" >= 0),

        constraint "zadim_rlc_window_check" check ("expires_at" > "window_start")
      );
    `);

    // كنسُ المنتهي بمسحٍ واحدٍ مفهرس — بلا هذا ينمو الجدولُ بلا سقف،
    // ويصير حارسُ الأمن نفسُه سببَ امتلاء القرص.
    this.addSql(`
      create index if not exists "IDX_zadim_rlc_expires"
        on "zadim_rate_limit_counter" ("expires_at");
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "zadim_rate_limit_counter" cascade;`);
    this.addSql(`drop table if exists "zadim_rate_limit_policy" cascade;`);
  }
}
