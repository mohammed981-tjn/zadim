-- ============================================================================
--  Zadim — Export Corridor Schema  (ممرّ الصادر)
-- ----------------------------------------------------------------------------
--  يُطبَّق **بعد** 02-database-schema.sql ويعتمد عليه (vendors · users).
--
--  قواعدُ هذا الملف هي قواعدُ المخطّط الأصل نفسُها، ولا تُكسر:
--
--  ١. المال بالوحدة الصغرى صحيحاً (BIGINT). لا FLOAT في حقلٍ ماليّ.
--     والكمّيةُ NUMERIC لأنها تُوزن لا تُعدّ — ١٢٫٥ طنّاً ليست عدداً صحيحاً،
--     وهذا الفرقُ هو سببُ وجود هذا الملف أصلاً.
--
--  ٢. لا قاعدةَ عملٍ مبرمَجة — ويمتدّ هذا هنا إلى **اللوائح**: أنواعُ
--     المستندات والجهاتُ المُصدِرة والممرّاتُ ومتطلّباتُها كلُّها صفوفٌ
--     يضبطها المدير. الكودُ محرّكٌ يقرأ القواعد، لا نسخةٌ منها.
--
--  ٣. القيدُ يحرس، لا شرطُ `if` في التطبيق.
--
--  ٤. الإرسالية تُجمَّد: تنسخ **مجموعةَ المتطلّبات السارية لحظتَها**، تماماً
--     كما ينسخ الطلبُ سعرَه. فتعديلُ لائحةٍ اليوم لا يُبطل شحنةَ أمس، ويبقى
--     التدقيقُ بعد سنتين قادراً على إعادة بناء ما كان مطلوباً حينها.
--
--  ٥. title_model في الإرسالية من اليوم (ADR-103) — المنصّةُ لا تملك البضاعة،
--     وإضافةُ العمود لاحقاً على سجلٍّ حيٍّ هجرةٌ توقف الممرّ.
--
--  يُنشَأ بـ:  psql -d zadim -v ON_ERROR_STOP=1 -f 13-export-corridor-schema.sql
-- ============================================================================

-- ============================================================================
--  ٠) أنواع
-- ============================================================================

-- وكالةٌ أم أصالة. اليوم كلُّها 'agency': المنصّة تربط ولا تشتري.
-- والعمودُ موجودٌ من اليوم لأن اليوم الذي نشتري فيه لن يكون يومَ هجرة.
CREATE TYPE title_model         AS ENUM ('agency','principal');

CREATE TYPE consignment_status  AS ENUM
  ('draft','documents_pending','inspection','cleared','shipped','delivered','settled','cancelled');

-- إلزاميٌّ يمنع الشحن · مشروطٌ يعتمد على شرطٍ خارجيّ يقرّره الموظّف ·
-- إرشاديٌّ يُعرض ولا يمنع. الثلاثةُ ضروريّة: لائحةٌ تسري بعد شهرٍ تُدخَل
-- إرشاديةً اليوم فيتدرّب عليها الموردون قبل أن تصير مانعة.
CREATE TYPE requirement_mode    AS ENUM ('mandatory','conditional','advisory');

CREATE TYPE custodian_kind      AS ENUM ('central_bank','commercial_bank','government_body');
CREATE TYPE escrow_status       AS ENUM ('awaiting_funds','funded','released','refunded','disputed');

-- ملفُّ اللوجستيّات. الامتثالُ يتعمّم بالبيانات، واللوجستيّاتُ لا تتعمّم:
-- الحيُّ يأكل ويشرب ويموت، والصمغُ يُخزَّن ويُدرَّج. فرقٌ في النوع لا في القيمة.
CREATE TYPE logistics_profile   AS ENUM ('bulk_dry','live_animal','high_value_secure');

CREATE TYPE entity_kind         AS ENUM
  ('exporter','customs_broker','carrier','laboratory','veterinary','quarantine','inspector','bank');

CREATE TYPE inspection_outcome  AS ENUM ('pass','fail','conditional');
CREATE TYPE transport_mode      AS ENUM ('road','sea','air','rail');

-- ============================================================================
--  ١) المرجعيّات — كلُّها بياناتٌ يحرّرها المدير من داخل المنصّة
-- ============================================================================

-- وحدةُ القياس صفٌّ لا ثابتٌ في الكود، لأن السلّة تنمو: طنٌّ وقنطارٌ ورأسٌ
-- وجوال. و to_base يجعل المقارنةَ ممكنةً بلا تحويلٍ مبعثرٍ في الشاشات.
CREATE TABLE uom (
    code        TEXT PRIMARY KEY,               -- 'kg' · 'ton' · 'head' · 'sack'
    name_ar     TEXT        NOT NULL,
    kind        TEXT        NOT NULL,           -- 'mass' · 'count' · 'volume'
    to_base     NUMERIC(20,8) NOT NULL,         -- إلى الوحدة الأساس لنوعها
    CONSTRAINT uom_kind_known CHECK (kind IN ('mass','count','volume')),
    CONSTRAINT uom_factor_positive CHECK (to_base > 0)
);

CREATE TABLE commodities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        NOT NULL UNIQUE,    -- 'gum_arabic' · 'live_sheep'
    name_ar     TEXT        NOT NULL,
    name_en     TEXT,
    hs_code     TEXT,                           -- البند الجمركي المنسّق
    uom_code    TEXT        NOT NULL REFERENCES uom(code),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE
);

-- الدرجةُ منفصلةٌ عن الصنف: «هشاب درجة ١» و«هشاب درجة ٢» سلعةٌ واحدة
-- بسعرين. ودمجُهما في الصنف يضاعف الكتالوج ويُفقد المقارنة.
CREATE TABLE commodity_grades (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commodity_id  UUID NOT NULL REFERENCES commodities(id) ON DELETE CASCADE,
    code          TEXT NOT NULL,
    name_ar       TEXT NOT NULL,
    spec          JSONB,                        -- الرطوبة · الشوائب · الوزن الحيّ
    UNIQUE (commodity_id, code)
);

CREATE TABLE destinations (
    code      TEXT PRIMARY KEY,                 -- 'SA' · 'EU' · 'AE' · 'CN'
    name_ar   TEXT NOT NULL,
    bloc      TEXT                              -- 'GCC' · 'EU' — للقواعد المشتركة
);

-- الجهةُ المُصدِرة للمستند أو الرخصة. تُدخَل ولا تُبرمَج، لأن الجهات تتغيّر
-- أسماؤها واختصاصاتها، ولأن ممرّاً جديداً يعني جهاتٍ لم نكن نعرفها.
CREATE TABLE authorities (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code      TEXT NOT NULL UNIQUE,
    name_ar   TEXT NOT NULL,
    country   TEXT NOT NULL,                    -- 'SD' · 'SA' · 'EU'
    kind      TEXT NOT NULL                     -- 'veterinary' · 'customs' · 'standards' · …
);

CREATE TABLE document_types (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT NOT NULL UNIQUE,         -- 'vet_health_cert' · 'eudr_dds' · …
    name_ar       TEXT NOT NULL,
    authority_id  UUID REFERENCES authorities(id),
    has_expiry    BOOLEAN NOT NULL DEFAULT FALSE,
    needs_number  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE licence_types (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT NOT NULL UNIQUE,         -- 'export_licence_crops' · …
    name_ar       TEXT NOT NULL,
    authority_id  UUID REFERENCES authorities(id)
);

-- ============================================================================
--  ٢) الجهات المهنية ورخصها  (ADR-105)
-- ----------------------------------------------------------------------------
--  الرخصةُ على الجهة، لا على المنصّة. المنصّةُ تتحقّق من سريانها ولا تحملها —
--  والفرقُ بين الموقفين مسؤوليةٌ قانونيةٌ كاملة عن كل إرسالية.
-- ============================================================================

CREATE TABLE professional_entities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        NOT NULL UNIQUE,
    name_ar     TEXT        NOT NULL,
    kind        entity_kind NOT NULL,
    vendor_id   UUID        REFERENCES vendors(id),   -- ADR-004
    country     TEXT        NOT NULL DEFAULT 'SD',
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE professional_entities IS
  'ADR-105: الرخصةُ على الجهة المهنية. المنصّة تتحقّق ولا تحمل.';

CREATE TABLE entity_licences (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id        UUID NOT NULL REFERENCES professional_entities(id) ON DELETE CASCADE,
    licence_type_id  UUID NOT NULL REFERENCES licence_types(id),
    number           TEXT NOT NULL,
    valid_from       DATE NOT NULL,
    valid_to         DATE NOT NULL,
    verified_at      TIMESTAMPTZ,
    verified_by      UUID REFERENCES users(id),
    evidence_ref     TEXT,                              -- مسارُ صورة الرخصة
    CONSTRAINT licence_window CHECK (valid_to > valid_from),
    UNIQUE (licence_type_id, number)
);

-- ============================================================================
--  ٣) الممرّات والمتطلّبات  (ADR-101 · ADR-102)
-- ----------------------------------------------------------------------------
--  الممرُّ = سلعة × وجهة. والفرقُ بين «صمغ إلى أوروبا» و«ضأن حيّ إلى
--  السعودية» صفوفٌ في corridor_requirements، لا فرعٌ في الكود. وهذا وحده
--  ما يجعل بناءَ الممرّين معاً ممكناً بكلفةِ واحد.
--
--  والمتطلّبُ **مؤرَّخ**: لائحةُ منع إزالة الغابات تسري 2026-12-30 وللمنشآت
--  الصغيرة 2027-06-30. فتُدخَل اليوم بتاريخ سريانها، وتصير مانعةً من نفسها.
-- ============================================================================

CREATE TABLE corridors (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code               TEXT NOT NULL UNIQUE,
    commodity_id       UUID NOT NULL REFERENCES commodities(id),
    destination_code   TEXT NOT NULL REFERENCES destinations(code),
    logistics_profile  logistics_profile NOT NULL,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (commodity_id, destination_code)
);

CREATE TABLE corridor_requirements (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corridor_id       UUID NOT NULL REFERENCES corridors(id) ON DELETE CASCADE,
    document_type_id  UUID NOT NULL REFERENCES document_types(id),
    mode              requirement_mode NOT NULL,
    effective_from    DATE NOT NULL,
    effective_to      DATE,                         -- NULL = سارٍ إلى أجلٍ غير مسمّى
    note              TEXT,
    CONSTRAINT requirement_window CHECK (effective_to IS NULL OR effective_to > effective_from),
    UNIQUE (corridor_id, document_type_id, effective_from)
);
COMMENT ON TABLE corridor_requirements IS
  'ADR-101: اللائحةُ صفٌّ مؤرَّخ. تعديلُها لا يمسّ إرساليةً جُمِّدت قبله.';

-- ============================================================================
--  ٤) الإرسالية
-- ============================================================================

CREATE TABLE consignments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference           TEXT NOT NULL UNIQUE,
    corridor_id         UUID NOT NULL REFERENCES corridors(id),
    vendor_id           UUID NOT NULL REFERENCES vendors(id),          -- ADR-004
    exporter_entity_id  UUID NOT NULL REFERENCES professional_entities(id),
    grade_id            UUID REFERENCES commodity_grades(id),

    -- الكمّيةُ عشرية. هذا هو البند الذي لا يُؤجَّل: عمودٌ صحيحٌ هنا يعني
    -- أن ٧٫٥ طنٍّ تُدوَّر إلى ٨ أو ٧، وأيُّهما خطأٌ في فاتورةٍ ومنشأٍ ووزن.
    quantity            NUMERIC(16,4) NOT NULL,
    uom_code            TEXT NOT NULL REFERENCES uom(code),

    unit_price_minor    BIGINT NOT NULL,      -- سعرُ الوحدة بالوحدة الصغرى
    currency_code       TEXT   NOT NULL,
    value_minor         BIGINT NOT NULL,      -- محروسٌ أدناه، لا محسوبٌ في الشاشة

    title_model         title_model NOT NULL DEFAULT 'agency',         -- ADR-103
    status              consignment_status NOT NULL DEFAULT 'draft',
    shipment_date       DATE,
    requirements_frozen_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT quantity_positive CHECK (quantity > 0),
    CONSTRAINT price_positive    CHECK (unit_price_minor > 0),
    -- حارسُ المجاميع، بنفس منطق order_totals في المخطّط الأصل: القيمةُ
    -- تُحرَس عند الكتابة لا تُحسَب عند العرض.
    CONSTRAINT value_balances    CHECK (value_minor = ROUND(quantity * unit_price_minor)),
    -- المنصّةُ لا تملك البضاعة اليوم. رفعُ هذا القيدِ قرارُ مالكٍ، لا سهوُ مبرمج.
    CONSTRAINT agency_only_today CHECK (title_model = 'agency')
);

-- المتطلّباتُ **المجمَّدة**: نسخةٌ مما كان سارياً لحظةَ التجميد.
CREATE TABLE consignment_requirements (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consignment_id        UUID NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
    document_type_id      UUID NOT NULL REFERENCES document_types(id),
    mode                  requirement_mode NOT NULL,
    source_requirement_id UUID REFERENCES corridor_requirements(id),
    frozen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (consignment_id, document_type_id)
);

CREATE TABLE consignment_documents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consignment_id      UUID NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
    document_type_id    UUID NOT NULL REFERENCES document_types(id),
    number              TEXT,
    issued_by_entity_id UUID REFERENCES professional_entities(id),
    issued_on           DATE,
    expires_on          DATE,
    file_ref            TEXT,
    verified_at         TIMESTAMPTZ,
    verified_by         UUID REFERENCES users(id),
    CONSTRAINT document_window CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on),
    UNIQUE (consignment_id, document_type_id)
);

-- إحداثيّاتُ الإنتاج — لائحةُ منع إزالة الغابات.
-- نقطةٌ تكفي لما دون ٤ هكتارات، ومضلَّعٌ لما فوقها. والقيدُ يفرضها لأن
-- الاكتشافَ عند الحدود اكتشافٌ متأخّرٌ بشهر.
CREATE TABLE consignment_origins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consignment_id  UUID NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
    plot_ref        TEXT NOT NULL,
    area_hectares   NUMERIC(12,4),
    latitude        NUMERIC(9,6) NOT NULL,
    longitude       NUMERIC(9,6) NOT NULL,
    boundary        JSONB,
    CONSTRAINT lat_range CHECK (latitude  BETWEEN -90  AND 90),
    CONSTRAINT lon_range CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT polygon_required_above_four_ha
      CHECK (area_hectares IS NULL OR area_hectares < 4 OR boundary IS NOT NULL)
);

-- سلسلةُ العهدة: تُلحَق ولا تُعدَّل ولا تُحذف.
-- للحيّ هي سلسلةُ المواقع من المولد إلى المسلخ، وللذهب سلسلةُ الحيازة.
-- وسلسلةُ عهدةٍ يمكن تعديلُها ليست سلسلةَ عهدة.
CREATE TABLE custody_events (
    id              BIGSERIAL PRIMARY KEY,
    consignment_id  UUID NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
    sequence        INTEGER NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL,
    place_name      TEXT NOT NULL,
    latitude        NUMERIC(9,6),
    longitude       NUMERIC(9,6),
    entity_id       UUID REFERENCES professional_entities(id),
    note            TEXT,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (consignment_id, sequence)
);

CREATE TABLE inspections (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consignment_id      UUID NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
    inspector_entity_id UUID NOT NULL REFERENCES professional_entities(id),
    performed_on        DATE NOT NULL,
    outcome             inspection_outcome NOT NULL,
    report_ref          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE logistics_legs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consignment_id    UUID NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
    sequence          INTEGER NOT NULL,
    mode              transport_mode NOT NULL,
    carrier_entity_id UUID REFERENCES professional_entities(id),
    from_place        TEXT NOT NULL,
    to_place          TEXT NOT NULL,
    departed_at       TIMESTAMPTZ,
    arrived_at        TIMESTAMPTZ,
    CONSTRAINT leg_order CHECK (arrived_at IS NULL OR departed_at IS NULL OR arrived_at >= departed_at),
    UNIQUE (consignment_id, sequence)
);

-- رعايةُ الحيّ أثناء النقل. جدولٌ منفصل لأن هذا هو الموضعُ الذي **لا**
-- يتعمّم فيه الممرّان: الصمغُ لا يشرب، والضأنُ يموت إن لم يُسقَ.
CREATE TABLE leg_welfare_checks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leg_id        UUID NOT NULL REFERENCES logistics_legs(id) ON DELETE CASCADE,
    checked_at    TIMESTAMPTZ NOT NULL,
    feed_given    BOOLEAN NOT NULL,
    water_given   BOOLEAN NOT NULL,
    mortality     INTEGER NOT NULL DEFAULT 0,
    note          TEXT,
    CONSTRAINT mortality_not_negative CHECK (mortality >= 0)
);

-- ============================================================================
--  ٥) المال — الضمانُ عند أمينٍ مرخَّص  (ADR-104)
-- ----------------------------------------------------------------------------
--  المنصّةُ **تسجّل التعليمات ولا تحتجز المال**. احتجازُ مال الغير نشاطٌ
--  خاضعٌ للترخيص، والأمينُ مصرفٌ أو جهةٌ حكومية. وهذا ليس تحفّظاً قانونياً
--  فحسب: نظامُ حصيلة الصادر يوجب مساراً مصرفياً موثَّقاً على أي حال.
-- ============================================================================

CREATE TABLE settlement_custodians (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code       TEXT NOT NULL UNIQUE,
    name_ar    TEXT NOT NULL,
    kind       custodian_kind NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE escrows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consignment_id  UUID NOT NULL UNIQUE REFERENCES consignments(id) ON DELETE CASCADE,
    custodian_id    UUID NOT NULL REFERENCES settlement_custodians(id),
    amount_minor    BIGINT NOT NULL,
    currency_code   TEXT   NOT NULL,
    status          escrow_status NOT NULL DEFAULT 'awaiting_funds',
    instruction_ref TEXT,
    funded_at       TIMESTAMPTZ,
    released_at     TIMESTAMPTZ,
    CONSTRAINT escrow_amount_positive CHECK (amount_minor > 0)
);

-- حصيلةُ الصادر: تُعاد خلال ٣٠ يوماً من الشحن.
-- المهلةُ عمودٌ محسوبٌ في القاعدة لا في التقرير، حتى لا يختلف تاريخان.
CREATE TABLE export_proceeds (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consignment_id   UUID NOT NULL UNIQUE REFERENCES consignments(id) ON DELETE CASCADE,
    shipment_date    DATE   NOT NULL,
    due_date         DATE   GENERATED ALWAYS AS (shipment_date + INTEGER '30') STORED,
    amount_minor     BIGINT NOT NULL,
    currency_code    TEXT   NOT NULL,
    bank_entity_id   UUID   REFERENCES professional_entities(id),
    repatriated_on   DATE,
    CONSTRAINT proceeds_positive CHECK (amount_minor > 0)
);

-- ============================================================================
--  ٦) الحرّاس — القيدُ يحرس، لا شرطُ `if`
-- ============================================================================

-- (١) التجميد. عند الخروج من 'draft' تُنسخ المتطلّباتُ السارية في تاريخ
--     الشحن (أو اليوم إن لم يُحدَّد). بعدها لا يمسّها تعديلُ اللائحة.
CREATE FUNCTION freeze_consignment_requirements() RETURNS TRIGGER AS $$
DECLARE
    as_of DATE := COALESCE(NEW.shipment_date, CURRENT_DATE);
BEGIN
    IF OLD.status = 'draft' AND NEW.status <> 'draft'
       AND NEW.requirements_frozen_at IS NULL THEN

        INSERT INTO consignment_requirements
              (consignment_id, document_type_id, mode, source_requirement_id)
        SELECT NEW.id, r.document_type_id, r.mode, r.id
          FROM corridor_requirements r
         WHERE r.corridor_id = NEW.corridor_id
           AND r.effective_from <= as_of
           AND (r.effective_to IS NULL OR r.effective_to > as_of)
        ON CONFLICT (consignment_id, document_type_id) DO NOTHING;

        NEW.requirements_frozen_at := now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consignment_freeze
    BEFORE UPDATE OF status ON consignments
    FOR EACH ROW EXECUTE FUNCTION freeze_consignment_requirements();

-- (٢) لا شحنَ بملفٍّ ناقص، ولا برخصةٍ منتهية، ولا بمستندٍ ينتهي قبل الشحن.
--     ثلاثةُ فحوصٍ في مكانٍ واحد لأنها كلُّها تُسأل عند اللحظة نفسها.
CREATE FUNCTION guard_consignment_shipment() RETURNS TRIGGER AS $$
DECLARE
    missing_doc  TEXT;
    expired_doc  TEXT;
    ship_on      DATE := COALESCE(NEW.shipment_date, CURRENT_DATE);
BEGIN
    IF NEW.status = 'shipped' AND OLD.status IS DISTINCT FROM 'shipped' THEN

        -- ٢-أ: مستندٌ إلزاميٌّ مجمَّدٌ بلا وثيقةٍ موثَّقة
        SELECT dt.name_ar INTO missing_doc
          FROM consignment_requirements cr
          JOIN document_types dt ON dt.id = cr.document_type_id
          LEFT JOIN consignment_documents cd
                 ON cd.consignment_id = cr.consignment_id
                AND cd.document_type_id = cr.document_type_id
                AND cd.verified_at IS NOT NULL
         WHERE cr.consignment_id = NEW.id
           AND cr.mode = 'mandatory'
           AND cd.id IS NULL
         LIMIT 1;

        IF missing_doc IS NOT NULL THEN
            RAISE EXCEPTION 'لا يمكن الشحن: مستندٌ إلزاميٌّ ناقص — %', missing_doc
                USING ERRCODE = 'P0001';
        END IF;

        -- ٢-ب: مستندٌ تنتهي صلاحيتُه قبل الشحن. الشهادةُ الصالحة أمسِ
        --      ليست صالحةً اليوم، والجمركُ يقرأ التاريخ لا النية.
        SELECT dt.name_ar INTO expired_doc
          FROM consignment_documents cd
          JOIN document_types dt ON dt.id = cd.document_type_id
         WHERE cd.consignment_id = NEW.id
           AND cd.expires_on IS NOT NULL
           AND cd.expires_on < ship_on
         LIMIT 1;

        IF expired_doc IS NOT NULL THEN
            RAISE EXCEPTION 'لا يمكن الشحن: مستندٌ انتهت صلاحيتُه قبل تاريخ الشحن — %', expired_doc
                USING ERRCODE = 'P0001';
        END IF;

        -- ٢-ج: رخصةُ المصدِّر سارية بتاريخ الشحن (ADR-105)
        IF NOT EXISTS (
            SELECT 1 FROM entity_licences l
             WHERE l.entity_id = NEW.exporter_entity_id
               AND l.verified_at IS NOT NULL
               AND ship_on BETWEEN l.valid_from AND l.valid_to
        ) THEN
            RAISE EXCEPTION 'لا يمكن الشحن: لا رخصةَ تصديرٍ موثَّقةً وساريةً بتاريخ الشحن'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consignment_shipment_guard
    BEFORE UPDATE ON consignments
    FOR EACH ROW EXECUTE FUNCTION guard_consignment_shipment();

-- (٣) سلسلةُ العهدة تُلحَق فقط.
CREATE RULE custody_no_update AS ON UPDATE TO custody_events DO INSTEAD NOTHING;
CREATE RULE custody_no_delete AS ON DELETE TO custody_events DO INSTEAD NOTHING;

-- (٤) لا إغلاقَ قبل عودة الحصيلة. النظامُ يوجب الإعادة خلال ٣٠ يوماً،
--     ونظامٌ يسمّي صفقةً «مسوّاة» وحصيلتُها لم تعد يكذب على صاحبه.
CREATE FUNCTION guard_settlement() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'settled' AND OLD.status IS DISTINCT FROM 'settled' THEN
        IF NOT EXISTS (
            SELECT 1 FROM export_proceeds p
             WHERE p.consignment_id = NEW.id AND p.repatriated_on IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'لا تُسوّى الإرسالية قبل تسجيل عودة حصيلة الصادر'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consignment_settlement_guard
    BEFORE UPDATE ON consignments
    FOR EACH ROW EXECUTE FUNCTION guard_settlement();

-- ============================================================================
--  ٧) فهارس
-- ============================================================================

CREATE INDEX consignments_by_status    ON consignments (status, shipment_date);
CREATE INDEX consignments_by_corridor  ON consignments (corridor_id);
CREATE INDEX requirements_by_corridor  ON corridor_requirements (corridor_id, effective_from);
CREATE INDEX documents_by_consignment  ON consignment_documents (consignment_id);
CREATE INDEX custody_by_consignment    ON custody_events (consignment_id, sequence);
CREATE INDEX licences_by_entity        ON entity_licences (entity_id, valid_to);

-- ============================================================================
--  ٨) بذرةُ الممرّين — بياناتٌ لا كود  (ADR-102)
-- ----------------------------------------------------------------------------
--  هذا القسمُ هو البرهان: الممرّان يختلفان في صفوفٍ فقط.
-- ============================================================================

INSERT INTO uom (code, name_ar, kind, to_base) VALUES
  ('kg',   'كيلوجرام', 'mass',  1),
  ('ton',  'طن',       'mass',  1000),
  ('head', 'رأس',      'count', 1),
  ('sack', 'جوال',     'mass',  50);

INSERT INTO destinations (code, name_ar, bloc) VALUES
  ('SA', 'السعودية',          'GCC'),
  ('EU', 'الاتحاد الأوروبي',  'EU'),
  ('AE', 'الإمارات',          'GCC');

INSERT INTO authorities (code, name_ar, country, kind) VALUES
  ('sd_vet',       'الإدارة العامة للمحاجر البيطرية وصحة اللحوم', 'SD', 'veterinary'),
  ('sd_plant',     'الإدارة العامة لوقاية النباتات',              'SD', 'plant_health'),
  ('sd_chamber',   'اتحاد الغرف التجارية',                        'SD', 'chamber'),
  ('sd_customs',   'الجمارك السودانية',                           'SD', 'customs'),
  ('sd_lab',       'المختبر القومي المعتمد',                      'SD', 'laboratory'),
  ('sa_sfda',      'الهيئة العامة للغذاء والدواء',                'SA', 'standards'),
  ('sa_saso',      'الهيئة السعودية للمواصفات — سابر',            'SA', 'standards'),
  ('eu_operator',  'المستورد الأوروبي — بيانُ العناية الواجبة',   'EU', 'due_diligence');

INSERT INTO document_types (code, name_ar, authority_id, has_expiry) VALUES
  ('origin_statement', 'بيانُ المنشأ — المصدِّر المسجَّل',
     (SELECT id FROM authorities WHERE code='sd_chamber'), FALSE),
  ('vet_health_cert',  'الشهادة الصحية البيطرية',
     (SELECT id FROM authorities WHERE code='sd_vet'), TRUE),
  ('quarantine_record','سجلُّ الحجر البيطري',
     (SELECT id FROM authorities WHERE code='sd_vet'), TRUE),
  ('phytosanitary',    'شهادةُ الصحة النباتية',
     (SELECT id FROM authorities WHERE code='sd_plant'), TRUE),
  ('lab_analysis',     'تقريرُ التحليل المختبري — أفلاتوكسين وسالمونيلا',
     (SELECT id FROM authorities WHERE code='sd_lab'), TRUE),
  ('eudr_dds',         'بيانُ العناية الواجبة — لائحةُ منع إزالة الغابات',
     (SELECT id FROM authorities WHERE code='eu_operator'), FALSE),
  ('saber_coc',        'شهادةُ مطابقة الإرسالية — سابر',
     (SELECT id FROM authorities WHERE code='sa_saso'), FALSE),
  ('sfda_pcoc',        'شهادةُ مطابقة المنتج الغذائي',
     (SELECT id FROM authorities WHERE code='sa_sfda'), FALSE),
  ('bill_of_lading',   'بوليصةُ الشحن',
     (SELECT id FROM authorities WHERE code='sd_customs'), FALSE),
  ('export_declaration','إقرارُ التصدير الجمركي',
     (SELECT id FROM authorities WHERE code='sd_customs'), FALSE);

INSERT INTO licence_types (code, name_ar, authority_id) VALUES
  ('export_crops',     'رخصةُ تصدير المحاصيل',
     (SELECT id FROM authorities WHERE code='sd_customs')),
  ('export_livestock', 'رخصةُ تصدير الثروة الحيوانية',
     (SELECT id FROM authorities WHERE code='sd_vet')),
  ('export_minerals',  'رخصةُ تصدير المعادن',
     (SELECT id FROM authorities WHERE code='sd_customs'));

INSERT INTO commodities (code, name_ar, name_en, hs_code, uom_code) VALUES
  ('gum_arabic', 'الصمغ العربي', 'Gum arabic', '130120', 'ton'),
  ('live_sheep', 'الضأن الحيّ',  'Live sheep', '010410', 'head'),
  ('sesame',     'السمسم',       'Sesame seed','120740', 'ton');

INSERT INTO commodity_grades (commodity_id, code, name_ar, spec)
SELECT id, 'hashab_1', 'هشاب درجة أولى',
       '{"moisture_max_pct":15,"insoluble_max_pct":0.5}'::jsonb
  FROM commodities WHERE code='gum_arabic';
INSERT INTO commodity_grades (commodity_id, code, name_ar, spec)
SELECT id, 'live_40kg', 'ضأن ٤٠ كجم فأكثر',
       '{"min_live_weight_kg":40}'::jsonb
  FROM commodities WHERE code='live_sheep';

INSERT INTO corridors (code, commodity_id, destination_code, logistics_profile) VALUES
  ('gum_eu',   (SELECT id FROM commodities WHERE code='gum_arabic'), 'EU', 'bulk_dry'),
  ('sheep_sa', (SELECT id FROM commodities WHERE code='live_sheep'), 'SA', 'live_animal');

-- الممرُّ الأوروبي للصمغ
INSERT INTO corridor_requirements (corridor_id, document_type_id, mode, effective_from, note)
SELECT (SELECT id FROM corridors WHERE code='gum_eu'),
       (SELECT id FROM document_types WHERE code=d), m, f, n
  FROM (VALUES
    ('origin_statement',  'mandatory'::requirement_mode, DATE '2020-01-01', 'نظامُ المصدِّر المسجَّل حلَّ محلَّ النموذج «أ»'),
    ('phytosanitary',     'mandatory', DATE '2020-01-01', NULL),
    ('lab_analysis',      'mandatory', DATE '2020-01-01', 'أفلاتوكسين وسالمونيلا — أشهرُ أسباب الرفض'),
    ('bill_of_lading',    'mandatory', DATE '2020-01-01', NULL),
    ('export_declaration','mandatory', DATE '2020-01-01', NULL),
    -- تسري من نفسها في موعدها. تُدخَل اليوم إرشاديةً فيتدرّب عليها المورِّدون.
    ('eudr_dds',          'advisory',  DATE '2025-01-01', 'إرشاديٌّ حتى موعد السريان'),
    ('eudr_dds',          'mandatory', DATE '2026-12-30', 'لائحةُ منع إزالة الغابات — المنشآت الكبرى')
  ) AS t(d, m, f, n);

-- الممرُّ السعودي للضأن الحيّ
INSERT INTO corridor_requirements (corridor_id, document_type_id, mode, effective_from, note)
SELECT (SELECT id FROM corridors WHERE code='sheep_sa'),
       (SELECT id FROM document_types WHERE code=d), m, f, n
  FROM (VALUES
    ('origin_statement',   'mandatory'::requirement_mode, DATE '2020-01-01', NULL),
    ('vet_health_cert',    'mandatory', DATE '2020-01-01', NULL),
    ('quarantine_record',  'mandatory', DATE '2020-01-01', 'الحجرُ قبل الشحن'),
    ('saber_coc',          'mandatory', DATE '2020-01-01', 'يستخرجها المستوردُ السعودي لا المصدِّر'),
    ('sfda_pcoc',          'conditional', DATE '2020-01-01', 'للمنتج الغذائي المنظَّم'),
    ('bill_of_lading',     'mandatory', DATE '2020-01-01', NULL),
    ('export_declaration', 'mandatory', DATE '2020-01-01', NULL)
  ) AS t(d, m, f, n);

INSERT INTO settlement_custodians (code, name_ar, kind) VALUES
  ('cbos',     'بنك السودان المركزي',       'central_bank'),
  ('gov_body', 'جهةٌ حكوميةٌ مخوَّلة',       'government_body');
