-- ============================================================================
--  Zadim — Database Schema  (المرحلة ٠)
-- ----------------------------------------------------------------------------
--  قواعدُ هذا الملف، ولا تُكسر:
--
--  ١. المال بالهللات صحيحاً (BIGINT). لا FLOAT ولا DOUBLE في حقلٍ ماليّ أبداً
--     (ADR-008) — 0.1 + 0.2 ≠ 0.3 في العشريّ الثنائي، والفرقُ يظهر في
--     تسوية آخر الشهر لا في الاختبار.
--  ٢. لا قاعدةَ عملٍ مبرمَجة: الأسعارُ والضرائبُ وأجورُ الشحن والخصوماتُ
--     والعمولات كلُّها صفوفٌ يضبطها المدير، لا ثوابتُ في الكود.
--  ٣. القيدُ يحرس، لا شرطُ `if` في التطبيق — الشرطُ يقرأ ثم يكتب، وبين
--     القراءة والكتابة يمرّ العميل الثاني.
--  ٤. الطلبُ يُجمَّد: بنودُه تنسخ السعر والاسم والتكلفة لحظتَه، ولا تشير
--     إلى الكتالوج للقراءة. فتغييرُ سعرٍ اليوم لا يمسّ فاتورة أمس.
--  ٥. vendor_id في كل جدولٍ تجاريّ من اليوم (ADR-004) — السوقُ معطَّلٌ في
--     الإطلاق، وإضافةُ العمود لاحقاً على مليون صفٍّ هجرةٌ تُوقف المتجر.
--
--  يُنشَأ بـ:  psql -d zadim -v ON_ERROR_STOP=1 -f 02-database-schema.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- بريدٌ غيرُ حسّاسٍ لحالة الأحرف
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- بحثٌ احتياطيّ داخل القاعدة

-- ============================================================================
--  ٠) أنواعٌ مشتركة
-- ============================================================================

-- ثلاثةُ محاورَ متعامدة، لا عمودٌ واحدٌ بستّ عشرة حالة (ADR-001).
-- والسبب: طلبٌ شُحن صنفاه واسترُدّ ثمنُ ثالثه لا تصفه حالةٌ واحدة.
CREATE TYPE order_status         AS ENUM ('draft','pending','confirmed','completed','cancelled');
CREATE TYPE payment_status       AS ENUM ('not_paid','authorized','partially_captured','captured','partially_refunded','refunded','failed');
CREATE TYPE fulfilment_status    AS ENUM ('not_fulfilled','partially_fulfilled','fulfilled','partially_returned','returned');

CREATE TYPE fulfilment_state     AS ENUM ('pending','picking','picked','packing','packed','ready_to_ship','shipped','out_for_delivery','delivered','cancelled','failed');
CREATE TYPE return_state         AS ENUM ('requested','info_requested','approved','rejected','in_transit','received','inspected','completed','cancelled');
CREATE TYPE po_state             AS ENUM ('draft','ordered','partially_received','received','cancelled');

CREATE TYPE stock_location_kind  AS ENUM ('warehouse','store','damaged','returned','in_transit');
CREATE TYPE movement_reason      AS ENUM ('purchase_receipt','sale','return_receipt','adjustment','transfer','damage','stocktake');
CREATE TYPE discount_kind        AS ENUM ('percentage','fixed_amount','free_shipping');
CREATE TYPE promotion_kind       AS ENUM ('automatic','coupon');

-- ============================================================================
--  ١) IDENTITY & ACCESS — الهوية والصلاحيات
-- ============================================================================

CREATE TABLE vendors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT        NOT NULL UNIQUE,
    name_ar         TEXT        NOT NULL,
    name_en         TEXT,
    commission_bps  INTEGER     NOT NULL DEFAULT 0,   -- نقاطُ الأساس: ٢٥٠ = ٢٫٥٪
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT commission_range CHECK (commission_bps BETWEEN 0 AND 10000)
);
COMMENT ON TABLE vendors IS
  'ADR-004: السوقُ في المخطط اليوم ومعطَّلٌ في الإطلاق. صفٌّ واحد افتراضيّ.';

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT      UNIQUE,
    phone           TEXT        UNIQUE,
    password_hash   TEXT,
    full_name       TEXT        NOT NULL,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- بريدٌ أو جوال، ولا بدّ من أحدهما: السوقُ السعودي هاتف-أولاً
    CONSTRAINT identity_present CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,      -- super_admin · operations · inventory · …
    name_ar     TEXT NOT NULL,
    is_system   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE permissions (
    code        TEXT PRIMARY KEY,          -- 'orders.refund' · 'products.price.update'
    domain      TEXT NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE role_permissions (
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE user_roles (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    vendor_id   UUID REFERENCES vendors(id),   -- دورٌ محصورٌ ببائع، أو عامٌّ إن NULL
    PRIMARY KEY (user_id, role_id)
);

-- سجلُّ التدقيق: يُلحَق ولا يُعدَّل ولا يُحذف.
-- سجلُّ تدقيقٍ يمكن تعديلُه ليس سجلَّ تدقيق (بند ٤٦).
CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    UUID REFERENCES users(id),
    actor_label TEXT        NOT NULL,       -- يبقى مقروءاً لو حُذف المستخدم
    action      TEXT        NOT NULL,       -- 'product.price.update'
    entity      TEXT        NOT NULL,
    entity_id   TEXT        NOT NULL,
    old_value   JSONB,
    new_value   JSONB,
    ip          INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_logs (entity, entity_id, created_at DESC);
CREATE INDEX audit_actor_idx  ON audit_logs (actor_id, created_at DESC);

CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

CREATE TABLE sales_channels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,      -- web · app · pos · marketplace · api
    name_ar     TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE sales_channels IS
  'ADR-003 (بند ٥٧): خادمُ تجارةٍ واحد وقنواتٌ متعدّدة. كلُّ طلبٍ يعرف قناته.';

CREATE TABLE api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES sales_channels(id),
    name        TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,      -- المفتاحُ نفسه لا يُخزَّن أبداً
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
--  ٢) CATALOG — الكتالوج
-- ============================================================================

CREATE TABLE brands (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name_ar     TEXT NOT NULL,
    name_en     TEXT,
    logo_url    TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   UUID REFERENCES categories(id) ON DELETE RESTRICT,
    slug        TEXT NOT NULL UNIQUE,
    name_ar     TEXT NOT NULL,
    name_en     TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT no_self_parent CHECK (parent_id IS DISTINCT FROM id)
);

-- الخصائصُ تُولّد فلاترَ التصنيف (بند ٣). لا فلاترَ مبرمَجةً في الواجهة.
CREATE TABLE attributes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT NOT NULL UNIQUE,     -- color · storage · size
    name_ar       TEXT NOT NULL,
    data_type     TEXT NOT NULL CHECK (data_type IN ('text','number','boolean','select')),
    is_filterable BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE category_attributes (
    category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (category_id, attribute_id)
);

CREATE TABLE products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id       UUID NOT NULL REFERENCES vendors(id),
    brand_id        UUID REFERENCES brands(id),
    slug            TEXT NOT NULL UNIQUE,
    title_ar        TEXT NOT NULL,
    title_en        TEXT,
    description_ar  TEXT,
    description_en  TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','active','archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE products IS
  'بند ٥: المنتج غلافٌ تسويقيّ. لا سعرَ فيه ولا مخزون — الوحدةُ البائعة هي variant.';

CREATE TABLE product_categories (
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, category_id)
);

CREATE TABLE product_options (       -- «اللون» و«السعة» لهذا المنتج
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name_ar     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE option_values (         -- «أسود» و«أزرق»
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_id   UUID NOT NULL REFERENCES product_options(id) ON DELETE CASCADE,
    value_ar    TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE product_variants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku             TEXT NOT NULL UNIQUE,
    barcode         TEXT UNIQUE,                    -- بند ١٥: من اليوم
    weight_grams    INTEGER,
    length_mm       INTEGER,
    width_mm        INTEGER,
    height_mm       INTEGER,
    requires_shipping BOOLEAN NOT NULL DEFAULT TRUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT positive_weight CHECK (weight_grams IS NULL OR weight_grams > 0)
);

CREATE TABLE variant_option_values (
    variant_id      UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    option_value_id UUID NOT NULL REFERENCES option_values(id) ON DELETE RESTRICT,
    PRIMARY KEY (variant_id, option_value_id)
);

CREATE TABLE product_attribute_values (
    product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES attributes(id) ON DELETE RESTRICT,
    value        TEXT NOT NULL,
    PRIMARY KEY (product_id, attribute_id)
);

CREATE TABLE media (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID REFERENCES products(id) ON DELETE CASCADE,
    variant_id  UUID REFERENCES product_variants(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    alt_ar      TEXT,
    kind        TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video')),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT media_owner CHECK (product_id IS NOT NULL OR variant_id IS NOT NULL)
);

CREATE TABLE bundles (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    child_variant_id  UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    CONSTRAINT no_self_bundle CHECK (parent_variant_id <> child_variant_id),
    UNIQUE (parent_variant_id, child_variant_id)
);

CREATE INDEX products_status_idx  ON products (status) WHERE status = 'active';
CREATE INDEX variants_product_idx ON product_variants (product_id);

-- ============================================================================
--  ٣) INVENTORY — المخزون · أخطرُ نطاقٍ في النظام
-- ============================================================================

CREATE TABLE stock_locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,          -- WH-RUH · WH-JED · WH-MAD
    name_ar     TEXT NOT NULL,
    kind        stock_location_kind NOT NULL DEFAULT 'warehouse',
    city        TEXT,
    latitude    NUMERIC(9,6),                  -- إحداثيّة لا مال: NUMERIC مقبول
    longitude   NUMERIC(9,6),
    priority    INTEGER NOT NULL DEFAULT 100,  -- الأصغرُ أولاً عند التساوي
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE stock_locations IS
  'بند ١٠: متعدّدُ المستودعات من اليوم. و damaged/returned مواقعُ منطقية لا حقول.';

CREATE TABLE inventory_levels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id      UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    location_id     UUID NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
    on_hand         INTEGER NOT NULL DEFAULT 0,
    reserved        INTEGER NOT NULL DEFAULT 0,
    incoming        INTEGER NOT NULL DEFAULT 0,   -- بأمر شراء (بند ٣٣)
    reorder_point   INTEGER,                      -- تنبيهُ «مخزونٌ منخفض»
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (variant_id, location_id),

    -- 🔴 الحرّاس الثلاثة التي تمنع المخزون السالب.
    -- القيدُ هو الحارس، لا شرطُ if في التطبيق: الشرطُ يقرأ ثم يكتب،
    -- وبين القراءة والكتابة يمرّ العميل الثاني (بند ٥٢).
    CONSTRAINT on_hand_not_negative  CHECK (on_hand  >= 0),
    CONSTRAINT reserved_not_negative CHECK (reserved >= 0),
    CONSTRAINT reserved_within_hand  CHECK (reserved <= on_hand)
);

-- available محسوبٌ لا مخزَّن: عمودٌ مخزَّنٌ ثالثٌ يعني ثلاثةَ أرقامٍ
-- يمكن أن تتناقض. والمشتقُّ لا يتناقض أبداً.
CREATE VIEW inventory_available AS
SELECT variant_id, location_id, on_hand - reserved AS available
FROM   inventory_levels;

CREATE TABLE reservations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id   UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    location_id  UUID NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
    order_id     UUID,                            -- FK يُضاف بعد إنشاء orders
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    expires_at   TIMESTAMPTZ,                     -- حجزُ السلة يسقط، وحجزُ الطلب لا
    released_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reservations_order_idx  ON reservations (order_id) WHERE released_at IS NULL;
CREATE INDEX reservations_expiry_idx ON reservations (expires_at) WHERE released_at IS NULL;

-- المخزونُ دفترُ يوميةٍ لا عدّاد: «كم لدينا؟» سهل، و«لماذا نقص أمس؟»
-- لا يُجاب إلا بدفتر.
CREATE TABLE stock_movements (
    id            BIGSERIAL PRIMARY KEY,
    variant_id    UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    location_id   UUID NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
    delta         INTEGER NOT NULL CHECK (delta <> 0),
    reason        movement_reason NOT NULL,
    reference     TEXT,                            -- رقم الطلب أو أمر الشراء
    actor_id      UUID REFERENCES users(id),
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX movements_variant_idx ON stock_movements (variant_id, created_at DESC);

-- ============================================================================
--  ٤) PRICING & PROMOTIONS — التسعير والعروض
-- ============================================================================

CREATE TABLE price_lists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,          -- default · b2b · vip
    name_ar     TEXT NOT NULL,
    priority    INTEGER NOT NULL DEFAULT 0,
    starts_at   TIMESTAMPTZ,
    ends_at     TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT window_ordered CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE prices (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id  UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    variant_id     UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    currency_code  CHAR(3) NOT NULL DEFAULT 'SAR',
    amount         BIGINT  NOT NULL,             -- هللات (ADR-008)
    compare_at     BIGINT,                       -- «السعر قبل» — للشطب
    min_quantity   INTEGER NOT NULL DEFAULT 1,
    UNIQUE (price_list_id, variant_id, currency_code, min_quantity),
    CONSTRAINT amount_not_negative CHECK (amount >= 0),
    CONSTRAINT compare_above CHECK (compare_at IS NULL OR compare_at > amount)
);

CREATE TABLE promotions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT UNIQUE,                 -- للكوبون فقط؛ NULL للتلقائي
    kind            promotion_kind NOT NULL,
    name_ar         TEXT    NOT NULL,
    discount_kind   discount_kind NOT NULL,
    discount_value  BIGINT  NOT NULL CHECK (discount_value >= 0),  -- هللات أو bps
    max_discount    BIGINT,                      -- سقفُ الخصم بالهللات
    min_order_total BIGINT,
    starts_at       TIMESTAMPTZ,
    ends_at         TIMESTAMPTZ,
    usage_limit     INTEGER,                     -- كلّياً
    per_user_limit  INTEGER,                     -- لكل مستخدم
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT coupon_needs_code CHECK (kind <> 'coupon' OR code IS NOT NULL),
    CONSTRAINT promo_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
COMMENT ON TABLE promotions IS
  'بند ٢٧: العرضُ يُطبَّق تلقائياً، والكوبون يُكتب. عمودُ kind يفصلهما ولا يخلطهما.';

-- شروطُ العرض بيانات لا كود (بند ٤٨): المديرُ يبني «أنفق ٢٠٠ واحصل على ٣٠».
CREATE TABLE promotion_rules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id  UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    field         TEXT NOT NULL,   -- cart.total · item.category_id · customer.segment
    operator      TEXT NOT NULL CHECK (operator IN ('eq','neq','gt','gte','lt','lte','in','not_in')),
    value         JSONB NOT NULL
);

-- 🔴 هنا يُمنع تجاوزُ حدّ الاستخدام عند التزاحم: قيدُ تفرّدٍ في القاعدة،
-- لا عدٌّ في التطبيق. وإلا مرّ ألفُ طلبٍ في ثانيةٍ على كوبونٍ حدُّه واحد.
CREATE TABLE coupon_redemptions (
    id            BIGSERIAL PRIMARY KEY,
    promotion_id  UUID NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
    customer_id   UUID,                         -- FK يُضاف بعد customers
    order_id      UUID,
    redeemed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX coupon_once_per_order ON coupon_redemptions (promotion_id, order_id);

CREATE TABLE flash_sales (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id  UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    variant_id    UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    stock_limit   INTEGER CHECK (stock_limit IS NULL OR stock_limit > 0),
    stock_sold    INTEGER NOT NULL DEFAULT 0,
    per_user_limit INTEGER,
    CONSTRAINT sold_within_limit CHECK (stock_limit IS NULL OR stock_sold <= stock_limit)
);

-- ============================================================================
--  ٥) CUSTOMERS — العملاء
-- ============================================================================

CREATE TABLE customers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    email         CITEXT,
    phone         TEXT,
    full_name     TEXT,
    is_guest      BOOLEAN NOT NULL DEFAULT FALSE,   -- بند ٨: الشراء بلا حساب
    accepts_marketing BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_phone_idx ON customers (phone);

-- العنوانُ الوطني السعودي: رمزٌ إضافيّ ورقمُ مبنى ورقمُ وحدة — لا يوجد
-- في النموذج الغربي (06-saudi-layer.md). يُصمَّم اليوم لا يُلصق لاحقاً.
CREATE TABLE addresses (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id    UUID REFERENCES customers(id) ON DELETE CASCADE,
    label          TEXT,                          -- منزل · عمل
    recipient_name TEXT NOT NULL,
    phone          TEXT NOT NULL,
    country_code   CHAR(2) NOT NULL DEFAULT 'SA',
    region         TEXT,
    city           TEXT NOT NULL,
    district       TEXT,
    street         TEXT,
    building_no    TEXT,
    unit_no        TEXT,
    postal_code    TEXT,
    additional_no  TEXT,                          -- الرمزُ الإضافي — سعوديّ
    latitude       NUMERIC(9,6),
    longitude      NUMERIC(9,6),
    is_default     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE wishlists (
    customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    variant_id   UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    -- السعرُ لحظةَ الإضافة: بلا هذا لا يمكن قول «انخفض السعر» (بند ٢٢)
    price_at_add BIGINT,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (customer_id, variant_id)
);

-- ============================================================================
--  ٦) ORDERING — الطلبات
-- ============================================================================

CREATE TABLE carts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
    channel_id    UUID NOT NULL REFERENCES sales_channels(id),
    currency_code CHAR(3) NOT NULL DEFAULT 'SAR',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id     UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    variant_id  UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    saved_for_later BOOLEAN NOT NULL DEFAULT FALSE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cart_id, variant_id, saved_for_later)
);
COMMENT ON TABLE cart_items IS
  'بند ٦: لا سعرَ هنا. السعرُ يُحسب حيّاً، ويُعاد التحقّق منه عند Checkout.';

CREATE TABLE orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number      TEXT NOT NULL UNIQUE,        -- مقروءٌ للعميل
    vendor_id         UUID NOT NULL REFERENCES vendors(id),
    customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
    channel_id        UUID NOT NULL REFERENCES sales_channels(id),

    -- ثلاثةُ محاورَ متعامدة (ADR-001)، لا عمودٌ بستّ عشرة حالة
    status            order_status      NOT NULL DEFAULT 'draft',
    payment_status    payment_status    NOT NULL DEFAULT 'not_paid',
    fulfilment_status fulfilment_status NOT NULL DEFAULT 'not_fulfilled',

    currency_code     CHAR(3) NOT NULL DEFAULT 'SAR',
    email             CITEXT,
    phone             TEXT,
    note              TEXT,
    placed_at         TIMESTAMPTZ,
    cancelled_at      TIMESTAMPTZ,
    cancel_reason     TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cancel_has_reason CHECK (cancelled_at IS NULL OR cancel_reason IS NOT NULL)
);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_status_idx   ON orders (status, payment_status, fulfilment_status);
CREATE INDEX orders_placed_idx   ON orders (placed_at DESC) WHERE placed_at IS NOT NULL;

ALTER TABLE reservations
    ADD CONSTRAINT reservations_order_fk
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE coupon_redemptions
    ADD CONSTRAINT redemptions_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    ADD CONSTRAINT redemptions_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

-- 🔴 البندُ مُجمَّد: ينسخ الاسمَ والسعر والتكلفة والضريبة لحظتَه.
-- ولا يقرأ الكتالوجَ ولا جدولَ الأسعار بعد ذلك أبداً — وإلا تغيّرت
-- فواتيرُ أمس كلما عدّل المديرُ سعراً اليوم.
CREATE TABLE order_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id     UUID REFERENCES product_variants(id) ON DELETE SET NULL,
    sku            TEXT    NOT NULL,               -- منسوخ
    title_ar       TEXT    NOT NULL,               -- منسوخ
    variant_label  TEXT,                           -- «أسود · ٢٥٦ج» — منسوخ
    quantity       INTEGER NOT NULL CHECK (quantity > 0),
    unit_price     BIGINT  NOT NULL CHECK (unit_price >= 0),
    unit_cost      BIGINT,                         -- COGS مجمَّدة (بند ٣٥)
    discount_total BIGINT  NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
    tax_total      BIGINT  NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
    line_total     BIGINT  NOT NULL CHECK (line_total >= 0),
    fulfilled_qty  INTEGER NOT NULL DEFAULT 0 CHECK (fulfilled_qty >= 0),
    returned_qty   INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty  >= 0),
    CONSTRAINT fulfilled_within_qty CHECK (fulfilled_qty <= quantity),
    CONSTRAINT returned_within_fulfilled CHECK (returned_qty <= fulfilled_qty)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

-- كلُّ حدٍّ على حدة، لا المجموعُ فقط: «كم من الإيراد شحنٌ وكم بضاعة؟»
-- لا يُجاب من رقمٍ واحد (بند ٦).
CREATE TABLE order_totals (
    order_id        UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    items_subtotal  BIGINT NOT NULL DEFAULT 0,
    shipping_total  BIGINT NOT NULL DEFAULT 0,
    tax_total       BIGINT NOT NULL DEFAULT 0,
    discount_total  BIGINT NOT NULL DEFAULT 0,
    coupon_total    BIGINT NOT NULL DEFAULT 0,
    store_credit    BIGINT NOT NULL DEFAULT 0,
    gift_wrap_total BIGINT NOT NULL DEFAULT 0,
    grand_total     BIGINT NOT NULL,
    CONSTRAINT totals_balance CHECK (
        grand_total = items_subtotal + shipping_total + tax_total + gift_wrap_total
                      - discount_total - coupon_total - store_credit
    ),
    CONSTRAINT grand_total_not_negative CHECK (grand_total >= 0)
);
COMMENT ON CONSTRAINT totals_balance ON order_totals IS
  'المعادلةُ تُفحص في القاعدة: مجموعٌ لا يساوي حدودَه عطلٌ يُرفض عند الكتابة لا يُكتشف في تقرير.';

CREATE TABLE order_addresses (
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('shipping','billing')),
    recipient_name TEXT NOT NULL,
    phone         TEXT NOT NULL,
    country_code  CHAR(2) NOT NULL DEFAULT 'SA',
    region        TEXT, city TEXT NOT NULL, district TEXT, street TEXT,
    building_no   TEXT, unit_no TEXT, postal_code TEXT, additional_no TEXT,
    latitude      NUMERIC(9,6), longitude NUMERIC(9,6),
    PRIMARY KEY (order_id, kind)
);

-- ============================================================================
--  ٧) PAYMENTS — المدفوعات
-- ============================================================================

CREATE TABLE payment_providers (
    code        TEXT PRIMARY KEY,          -- moyasar · tabby · tamara · cod
    name_ar     TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb   -- بلا أسرار: المفاتيح في البيئة
);

CREATE TABLE payments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    provider_code  TEXT NOT NULL REFERENCES payment_providers(code),
    method         TEXT,                        -- mada · visa · applepay · cod
    currency_code  CHAR(3) NOT NULL DEFAULT 'SAR',
    authorized_amount BIGINT NOT NULL DEFAULT 0 CHECK (authorized_amount >= 0),
    captured_amount   BIGINT NOT NULL DEFAULT 0 CHECK (captured_amount   >= 0),
    refunded_amount   BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount   >= 0),
    provider_ref   TEXT,
    idempotency_key TEXT UNIQUE,                -- يمنع التحصيل مرتين عند إعادة المحاولة
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT captured_within_authorized CHECK (captured_amount <= authorized_amount),
    CONSTRAINT refunded_within_captured  CHECK (refunded_amount <= captured_amount)
);
CREATE INDEX payments_order_idx ON payments (order_id);

CREATE TABLE refunds (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id    UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    amount        BIGINT NOT NULL CHECK (amount > 0),
    kind          TEXT NOT NULL CHECK (kind IN ('items','shipping','goodwill','store_credit')),
    reason        TEXT NOT NULL,               -- بند ٢٠: السببُ إلزاميّ
    actor_id      UUID NOT NULL REFERENCES users(id),  -- ومن صرفه إلزاميّ
    provider_ref  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE store_credits (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    delta        BIGINT NOT NULL CHECK (delta <> 0),   -- دفترُ قيود، لا رصيد
    reason       TEXT NOT NULL,
    order_id     UUID REFERENCES orders(id),
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
--  ٨) FULFILMENT — التنفيذ والشحن وتشغيل المستودع
-- ============================================================================

CREATE TABLE carriers (
    code        TEXT PRIMARY KEY,             -- smsa · aramex · naqel
    name_ar     TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE carriers IS
  'بند ١٧: محوّلُ ناقلٍ واحد بأربع دوالّ. ناقلٌ رابع = ملفٌّ جديد وصفرُ تعديلٍ في الطلبات.';

CREATE TABLE shipping_zones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_ar     TEXT NOT NULL,
    country_code CHAR(2) NOT NULL DEFAULT 'SA',
    regions     TEXT[] NOT NULL DEFAULT '{}',
    cities      TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE shipping_options (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id      UUID NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
    carrier_code TEXT REFERENCES carriers(code),
    code         TEXT NOT NULL,               -- standard · express · same_day · pickup
    name_ar      TEXT NOT NULL,
    min_days     INTEGER, max_days INTEGER,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (zone_id, code)
);

-- 🔴 بند ١٦: الأجرةُ بيانات لا كود. «شحن = ٢٠ ريال» في الكود عطلٌ لا خيار.
CREATE TABLE shipping_rates (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_id          UUID NOT NULL REFERENCES shipping_options(id) ON DELETE CASCADE,
    min_weight_grams   INTEGER NOT NULL DEFAULT 0,
    max_weight_grams   INTEGER,
    min_order_total    BIGINT,
    price              BIGINT NOT NULL CHECK (price >= 0),
    free_above_total   BIGINT,                -- الشحنُ المجاني فوق مبلغ
    CONSTRAINT weight_range CHECK (max_weight_grams IS NULL OR max_weight_grams > min_weight_grams)
);

CREATE TABLE fulfilments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    location_id   UUID NOT NULL REFERENCES stock_locations(id),
    state         fulfilment_state NOT NULL DEFAULT 'pending',
    option_id     UUID REFERENCES shipping_options(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE fulfilments IS
  'الوحدةُ التي تُشحن. طلبٌ من موقعين = تنفيذان، لكلٍّ لقطُه وتغليفُه وتتبّعُه.';

CREATE TABLE fulfilment_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fulfilment_id  UUID NOT NULL REFERENCES fulfilments(id) ON DELETE CASCADE,
    order_item_id  UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    quantity       INTEGER NOT NULL CHECK (quantity > 0),
    UNIQUE (fulfilment_id, order_item_id)
);

CREATE TABLE pick_lists (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fulfilment_id  UUID NOT NULL REFERENCES fulfilments(id) ON DELETE CASCADE,
    picker_id      UUID REFERENCES users(id),
    started_at     TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pick_list_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pick_list_id  UUID NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
    variant_id    UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    picked_qty    INTEGER NOT NULL DEFAULT 0 CHECK (picked_qty >= 0),
    aisle         TEXT, shelf TEXT, bin TEXT,     -- بند ١٣
    walk_order    INTEGER NOT NULL DEFAULT 0,     -- ترتيبُ المشي لا ترتيبُ البند
    scanned_at    TIMESTAMPTZ,
    CONSTRAINT picked_within_qty CHECK (picked_qty <= quantity)
);
COMMENT ON COLUMN pick_list_items.walk_order IS
  'مرتَّبٌ بمسار المشي: موظّفٌ يمشي الممرّات بالترتيب أسرعُ من واحدٍ يقفز بينها.';

CREATE TABLE packages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fulfilment_id  UUID NOT NULL REFERENCES fulfilments(id) ON DELETE CASCADE,
    packer_id      UUID REFERENCES users(id),
    barcode        TEXT UNIQUE,                   -- بند ١٥
    weight_grams   INTEGER CHECK (weight_grams IS NULL OR weight_grams > 0),
    box_type       TEXT,
    packed_at      TIMESTAMPTZ
);

CREATE TABLE shipments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fulfilment_id  UUID NOT NULL REFERENCES fulfilments(id) ON DELETE RESTRICT,
    carrier_code   TEXT NOT NULL REFERENCES carriers(code),
    tracking_number TEXT,
    label_url      TEXT,
    shipped_at     TIMESTAMPTZ,
    delivered_at   TIMESTAMPTZ,
    estimated_at   TIMESTAMPTZ,
    UNIQUE (carrier_code, tracking_number)
);

CREATE TABLE tracking_events (
    id           BIGSERIAL PRIMARY KEY,
    shipment_id  UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    code         TEXT NOT NULL,
    description_ar TEXT,
    location     TEXT,
    occurred_at  TIMESTAMPTZ NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tracking_shipment_idx ON tracking_events (shipment_id, occurred_at DESC);

-- ============================================================================
--  ٩) RETURNS — المرتجعات
-- ============================================================================

CREATE TABLE return_reasons (
    code        TEXT PRIMARY KEY,
    name_ar     TEXT NOT NULL,
    requires_photo BOOLEAN NOT NULL DEFAULT FALSE,
    restock_default BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE return_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
    state         return_state NOT NULL DEFAULT 'requested',
    reason_code   TEXT NOT NULL REFERENCES return_reasons(code),
    customer_note TEXT,
    admin_note    TEXT,
    refund_method TEXT CHECK (refund_method IN ('original','store_credit','exchange')),
    pickup        BOOLEAN NOT NULL DEFAULT FALSE,
    decided_by    UUID REFERENCES users(id),
    decided_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT decision_has_actor CHECK (decided_at IS NULL OR decided_by IS NOT NULL)
);

CREATE TABLE return_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
    order_item_id     UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    received_qty      INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    -- قرارُ الفحص بشريّ: من يُعيد الراجعَ إلى الرفّ آلياً يبيع تالفاً
    inspection        TEXT CHECK (inspection IN ('resellable','damaged','missing')),
    photo_urls        TEXT[] NOT NULL DEFAULT '{}',
    CONSTRAINT received_within_qty CHECK (received_qty <= quantity)
);

-- ============================================================================
--  ١٠) LOYALTY & MEMBERSHIP — الولاء والعضوية
-- ============================================================================

CREATE TABLE loyalty_tiers (
    code             TEXT PRIMARY KEY,        -- silver · gold · platinum
    name_ar          TEXT NOT NULL,
    min_points       INTEGER NOT NULL DEFAULT 0,
    earn_multiplier_bps INTEGER NOT NULL DEFAULT 10000,  -- ١٠٠٠٠ = ×١
    sort_order       INTEGER NOT NULL DEFAULT 0
);

-- قواعدُ الكسب والصرف إعدادٌ للمدير لا ثابتٌ في الكود (بند ٢٤).
CREATE TABLE loyalty_settings (
    id                    BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),  -- صفٌّ واحد
    points_per_currency   INTEGER NOT NULL DEFAULT 1,      -- نقطة لكل ريال
    currency_per_point_bps INTEGER NOT NULL DEFAULT 100,   -- قيمةُ النقطة بالهللات×bps
    expiry_months         INTEGER,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- دفترُ قيود، لا عمودُ رصيدٍ يُحدَّث: العمودُ المحدَّث يفقد التاريخ
-- ويختلّ عند التزاحم.
CREATE TABLE loyalty_transactions (
    id           BIGSERIAL PRIMARY KEY,
    customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    points       INTEGER NOT NULL CHECK (points <> 0),
    reason       TEXT NOT NULL,
    order_id     UUID REFERENCES orders(id),
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_customer_idx ON loyalty_transactions (customer_id, created_at DESC);

CREATE TABLE memberships (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    plan_code     TEXT NOT NULL,
    price         BIGINT NOT NULL CHECK (price >= 0),
    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,
    auto_renew    BOOLEAN NOT NULL DEFAULT TRUE,
    cancelled_at  TIMESTAMPTZ,
    CONSTRAINT membership_window CHECK (ends_at > starts_at)
);

-- التقييمُ يشترط الشراء: قيدٌ لا فحصُ واجهة (بند ٢٣).
CREATE TABLE reviews (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    order_item_id  UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body           TEXT,
    photo_urls     TEXT[] NOT NULL DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','published','rejected')),
    helpful_count  INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_item_id, customer_id)          -- تقييمٌ واحد لكل بندٍ اشتُري
);

CREATE TABLE customer_segments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,
    name_ar     TEXT NOT NULL,
    rules       JSONB NOT NULL,                 -- شرائحُ ديناميكية بالقواعد
    is_dynamic  BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================================================
--  ١١) SUPPLIERS & PURCHASING — الموردون وأوامر الشراء
-- ============================================================================

CREATE TABLE suppliers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code           TEXT NOT NULL UNIQUE,
    name_ar        TEXT NOT NULL,
    contact_email  CITEXT,
    contact_phone  TEXT,
    lead_time_days INTEGER,
    min_order_total BIGINT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE supplier_variants (
    supplier_id  UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    variant_id   UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    supplier_sku TEXT,
    unit_cost    BIGINT NOT NULL CHECK (unit_cost >= 0),
    PRIMARY KEY (supplier_id, variant_id)
);

CREATE TABLE purchase_orders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number     TEXT NOT NULL UNIQUE,
    supplier_id   UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    location_id   UUID NOT NULL REFERENCES stock_locations(id),
    state         po_state NOT NULL DEFAULT 'draft',
    expected_at   TIMESTAMPTZ,
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id        UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    variant_id   UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    received_qty INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    unit_cost    BIGINT  NOT NULL CHECK (unit_cost >= 0),
    CONSTRAINT po_received_within_qty CHECK (received_qty <= quantity)
);

-- ============================================================================
--  ١٢) FINANCE & TAX — المالية والضريبة
-- ============================================================================

CREATE TABLE tax_regions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country_code CHAR(2) NOT NULL,
    region       TEXT,
    UNIQUE (country_code, region)
);

CREATE TABLE tax_rates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id     UUID NOT NULL REFERENCES tax_regions(id) ON DELETE CASCADE,
    category_id   UUID REFERENCES categories(id),     -- NULL = كلُّ الفئات
    customer_kind TEXT CHECK (customer_kind IN ('b2c','b2b')),
    rate_bps      INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000), -- ١٥٠٠ = ١٥٪
    is_inclusive  BOOLEAN NOT NULL DEFAULT TRUE,      -- السعرُ شاملٌ للضريبة
    starts_at     TIMESTAMPTZ,
    ends_at       TIMESTAMPTZ
);
COMMENT ON TABLE tax_rates IS
  'بند ٣٦: النسبةُ صفٌّ لا ثابتٌ في الواجهة. وتغيُّرُ النسبة لا يمسّ فواتيرَ سابقة.';

CREATE TABLE payment_fees (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id    UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    amount        BIGINT NOT NULL CHECK (amount >= 0),
    provider_code TEXT NOT NULL REFERENCES payment_providers(code)
);

-- ZATCA: تسلسلٌ غيرُ منقطع وتجزئةٌ مرتبطةٌ بالسابقة (06-saudi-layer.md).
-- وهذا القيدُ هو ما يجعل الإضافةَ لاحقاً إعادةَ بناءٍ لا ميزةً تُضاف.
CREATE TABLE zatca_invoices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    sequence_no     BIGINT NOT NULL UNIQUE,          -- لا فجوةَ ولا تكرار
    uuid_v4         UUID NOT NULL UNIQUE,
    invoice_hash    TEXT NOT NULL,
    previous_hash   TEXT,                            -- سلسلةٌ مرتبطة
    qr_base64       TEXT NOT NULL,
    xml_url         TEXT,
    cleared_at      TIMESTAMPTZ,
    clearance_status TEXT CHECK (clearance_status IN ('pending','cleared','reported','failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE vendor_commissions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id    UUID NOT NULL REFERENCES vendors(id),
    order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    gross_amount BIGINT NOT NULL CHECK (gross_amount >= 0),
    commission   BIGINT NOT NULL CHECK (commission >= 0),
    net_payable  BIGINT NOT NULL CHECK (net_payable >= 0),
    settled_at   TIMESTAMPTZ,
    CONSTRAINT commission_within_gross CHECK (commission <= gross_amount)
);

-- ============================================================================
--  ١٣) CONTENT — المحتوى والـSEO
-- ============================================================================

CREATE TABLE pages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    title_ar    TEXT NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT FALSE
);

-- بند ٣٧: الصفحةُ الرئيسية بيانات. ترتيبُها يتغيّر بسحبٍ وإفلاتٍ في
-- اللوحة، بلا نشرِ كود.
CREATE TABLE page_blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id     UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN (
                    'banner','product_carousel','category_grid','brand_grid',
                    'flash_sale','best_sellers','new_arrivals','recommended',
                    'text','video','promotion')),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_visible  BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at   TIMESTAMPTZ,
    ends_at     TIMESTAMPTZ
);
CREATE INDEX page_blocks_order_idx ON page_blocks (page_id, sort_order);

CREATE TABLE seo_meta (
    entity      TEXT NOT NULL CHECK (entity IN ('product','category','brand','page')),
    entity_id   UUID NOT NULL,
    locale      CHAR(2) NOT NULL DEFAULT 'ar',
    title       TEXT, description TEXT, canonical_url TEXT,
    og_image    TEXT, structured_data JSONB,
    PRIMARY KEY (entity, entity_id, locale)
);

CREATE TABLE redirects (
    from_path  TEXT PRIMARY KEY,
    to_path    TEXT NOT NULL,
    status     SMALLINT NOT NULL DEFAULT 301 CHECK (status IN (301,302))
);

-- ============================================================================
--  ١٤) NOTIFICATIONS & SUPPORT — الإشعارات والدعم
-- ============================================================================

CREATE TABLE notification_templates (
    code        TEXT PRIMARY KEY,            -- order.shipped · price.dropped
    channel     TEXT NOT NULL CHECK (channel IN ('email','sms','push','whatsapp')),
    subject_ar  TEXT,
    body_ar     TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE outbox_events (
    id           BIGSERIAL PRIMARY KEY,
    topic        TEXT NOT NULL,              -- OrderCreated · RefundIssued …
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT
);
CREATE INDEX outbox_pending_idx ON outbox_events (created_at) WHERE processed_at IS NULL;
COMMENT ON TABLE outbox_events IS
  'نمطُ Outbox: الحدثُ يُكتب في نفس معاملة التغيير. فلا يُرسل إشعارُ شحنٍ لطلبٍ فشلت كتابتُه، ولا يضيع إشعارٌ لأن الطابور سقط.';

CREATE TABLE support_tickets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
    subject     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','pending','resolved','closed')),
    assignee_id UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_messages (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_kind TEXT NOT NULL CHECK (author_kind IN ('customer','agent','system')),
    author_id   UUID,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
--  ١٥) بذورٌ لا غنى عنها — النظامُ لا يقلع بدونها
-- ============================================================================

INSERT INTO vendors (id, code, name_ar, commission_bps)
VALUES ('00000000-0000-0000-0000-000000000001', 'default', 'التاجر الأساسي', 0);

INSERT INTO sales_channels (code, name_ar) VALUES
    ('web','الموقع'), ('app','التطبيق'), ('pos','نقطة البيع'),
    ('marketplace','السوق'), ('api','الواجهة البرمجية');

INSERT INTO roles (code, name_ar, is_system) VALUES
    ('super_admin','مدير عام', TRUE),
    ('operations','مدير التشغيل', TRUE),
    ('inventory','مدير المخزون', TRUE),
    ('product','مدير المنتجات', TRUE),
    ('marketing','مدير التسويق', TRUE),
    ('support','موظف الدعم', TRUE),
    ('finance','المالية', TRUE);

INSERT INTO loyalty_settings (id) VALUES (TRUE);

-- ============================================================================
--  نهاية المخطط.
--  ما ليس هنا عمداً: الفهارسُ الدقيقة تُضاف بقياس الاستعلامات لا بالتخمين،
--  وسياساتُ RLS تُكتب في المرحلة ١ مع طبقة الصلاحيات (05-rbac-matrix.md).
-- ============================================================================
