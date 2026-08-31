import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * SEO والتحويلات (بند ٣٨). بخطّ اليد — المولّد يسقط على الوحدات
 * المحلية في 2.19.0 (ADR-001).
 */
export class Migration20260831000002 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_seo_meta" (
        "id"              text not null,
        "entity"          text not null,
        "entity_id"       text not null,
        "locale"          text not null default 'ar',
        "title"           text null,
        "description"     text null,
        "canonical_url"   text null,
        "og_image"        text null,
        "structured_data" jsonb null,
        "no_index"        boolean not null default false,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "zadim_seo_meta_pkey" primary key ("id"),
        constraint "zadim_seo_meta_entity_check"
          check ("entity" in ('product','category','brand','page'))
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_seo_meta_unique"
        on "zadim_seo_meta" (entity, entity_id, locale) where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_seo_meta_entity"
        on "zadim_seo_meta" (entity, entity_id) where deleted_at is null;
    `);

    this.addSql(`
      create table if not exists "zadim_url_redirect" (
        "id"         text not null,
        "from_path"  text not null,
        "to_path"    text not null,
        "status"     integer not null default 301,
        "hits"       integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "zadim_url_redirect_pkey" primary key ("id"),
        -- 301 و302 وحدهما: أي رمزٍ آخر في حقل تحويلٍ عطلُ إعدادٍ
        -- يُنتج ردّاً لا يفهمه المتصفّح ولا محرّكُ البحث.
        constraint "zadim_url_redirect_status_check" check ("status" in (301, 302)),
        -- 🔴 مسارٌ يحوّل إلى نفسه = حلقةٌ لا نهائية. القيدُ يمنعها عند
        -- الكتابة لا حين يعلق زائرٌ في الدوران.
        constraint "zadim_url_redirect_no_self" check ("from_path" <> "to_path")
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_url_redirect_from_unique"
        on "zadim_url_redirect" (from_path) where deleted_at is null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "zadim_url_redirect" cascade;`);
    this.addSql(`drop table if exists "zadim_seo_meta" cascade;`);
  }
}
