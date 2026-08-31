import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * وحدة catalog — الخصائص وربطُها بالتصنيفات وقيمُها ومرادفاتُ البحث.
 *
 * ⚠️ بخطّ اليد لا بـ`medusa db:generate`: المولّد يسقط على الوحدات
 * المحلية في 2.19.0 (ADR-001).
 *
 * ولا مفاتيحَ أجنبية على `product_id` و`category_id`: كلاهما يسكن وحدةَ
 * المنتجات في Medusa، والعبورُ بين الوحدات لا يكون بـFK.
 */
export class Migration20260831000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "zadim_attribute" (
        "id"            text not null,
        "code"          text not null,
        "name_ar"       text not null,
        "name_en"       text null,
        "data_type"     text not null default 'text',
        "is_filterable" boolean not null default true,
        "sort_order"    integer not null default 0,
        "created_at"    timestamptz not null default now(),
        "updated_at"    timestamptz not null default now(),
        "deleted_at"    timestamptz null,
        constraint "zadim_attribute_pkey" primary key ("id"),
        constraint "zadim_attribute_data_type_check"
          check ("data_type" in ('text','number','boolean','select'))
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_attribute_code_unique"
        on "zadim_attribute" (code) where deleted_at is null;
    `);

    this.addSql(`
      create table if not exists "zadim_category_attribute" (
        "id"           text not null,
        "category_id"  text not null,
        "attribute_id" text not null,
        "sort_order"   integer not null default 0,
        "created_at"   timestamptz not null default now(),
        "updated_at"   timestamptz not null default now(),
        "deleted_at"   timestamptz null,
        constraint "zadim_category_attribute_pkey" primary key ("id"),
        constraint "zadim_category_attribute_attr_fk"
          foreign key ("attribute_id") references "zadim_attribute" ("id")
          on update cascade on delete cascade
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_category_attribute_unique"
        on "zadim_category_attribute" (category_id, attribute_id) where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_category_attribute_category"
        on "zadim_category_attribute" (category_id) where deleted_at is null;
    `);

    this.addSql(`
      create table if not exists "zadim_product_attribute_value" (
        "id"               text not null,
        "product_id"       text not null,
        "attribute_id"     text not null,
        "value"            text not null,
        "value_normalized" text not null,
        "created_at"       timestamptz not null default now(),
        "updated_at"       timestamptz not null default now(),
        "deleted_at"       timestamptz null,
        constraint "zadim_product_attribute_value_pkey" primary key ("id"),
        constraint "zadim_product_attribute_value_attr_fk"
          foreign key ("attribute_id") references "zadim_attribute" ("id")
          on update cascade on delete cascade
      );
    `);
    this.addSql(`
      create unique index if not exists "IDX_zadim_pav_unique"
        on "zadim_product_attribute_value" (product_id, attribute_id) where deleted_at is null;
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_pav_lookup"
        on "zadim_product_attribute_value" (attribute_id, value_normalized) where deleted_at is null;
    `);

    this.addSql(`
      create table if not exists "zadim_search_synonym" (
        "id"              text not null,
        "term"            text not null,
        "term_normalized" text not null,
        "synonyms"        text[] not null default '{}',
        "is_active"       boolean not null default true,
        "created_at"      timestamptz not null default now(),
        "updated_at"      timestamptz not null default now(),
        "deleted_at"      timestamptz null,
        constraint "zadim_search_synonym_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index if not exists "IDX_zadim_search_synonym_normalized"
        on "zadim_search_synonym" (term_normalized) where deleted_at is null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`drop table if exists "zadim_search_synonym" cascade;`);
    this.addSql(`drop table if exists "zadim_product_attribute_value" cascade;`);
    this.addSql(`drop table if exists "zadim_category_attribute" cascade;`);
    this.addSql(`drop table if exists "zadim_attribute" cascade;`);
  }
}
