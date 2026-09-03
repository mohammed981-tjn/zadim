-- ============================================================================
--  Zadim — جسر سودجري: العرضُ الموثّق يصير إرسالية
-- ----------------------------------------------------------------------------
--  يُطبَّق **بعد** 02 و13.
--
--  الاتجاه واحد: سودجري يُنتج، وزاديم يستقبل. ولا يعرف أيُّهما جداولَ الآخر.
--
--  قواعدُ هذا الملف:
--
--  ١. **لا مفتاحَ أجنبياً يعبر الحدّ.** الإرسالية بعد الإدماج مكتملةٌ بذاتها:
--     لو اختفى سودجري غداً بقيت مراجعتُها ممكنة. وهذا هو الفرق بين جسرٍ
--     ودمجِ قاعدتين.
--
--  ٢. **الجسر لا يصنع هويّة.** المصدِّر يُحَلّ من `professional_entities`
--     بالرمز، وعرضٌ يسمّي مصدِّراً لا نعرفه **يُرفض**. الرخصة يوثّقها إنسانٌ
--     هنا، ولا تُستورد من حمولةٍ قادمة.
--
--  ٣. **الإدماج يُنزل في `draft` دائماً.** الجسر لا يشحن ولا يُسوّي. وكلُّ
--     حرّاس 13 تبقى بينه وبين الشحن.
--
--  ٤. **العرضُ المرفوض يُسجَّل بسببه.** رفضٌ صامت يجعل المُرسِل ينتظر رداً
--     لا يأتي، ويجعلنا لا نعرف كم عرضاً سقط ولا لماذا.
--
--  ٥. **الأدلّة تعبر مرجعاً وبصمةً لا ملفاً.** مخزن سودجري خاصّ ولا يقرؤه
--     زاديم. فما يعبر يكفي لأن يطلب مدقّقٌ الأصل ويتحقّق أنه لم يُبدَّل،
--     ولا يدّعي أننا نملكه.
--
--  يُنشَأ بـ:  psql -d zadim -v ON_ERROR_STOP=1 -f 15-bridge-schema.sql
-- ============================================================================

CREATE TYPE offer_status AS ENUM ('accepted', 'rejected');

-- ============================================================================
--  ١) دفترُ الوارد
-- ============================================================================

CREATE TABLE inbound_offers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source         TEXT        NOT NULL,     -- 'sudagri'
    external_ref   TEXT        NOT NULL,     -- معرّفه هناك — نصٌّ لا مفتاح
    payload        JSONB       NOT NULL,     -- كما وصل، بلا تنقيح
    received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    status         offer_status NOT NULL,
    reject_reason  TEXT,
    consignment_id UUID REFERENCES consignments(id),

    -- الإدماجُ مرّةً واحدة: إعادةُ الإرسال لا تُنشئ إرساليةً ثانية.
    -- والشبكاتُ تُعيد الإرسال بطبعها — انقطاعٌ بعد الكتابة وقبل الردّ يجعل
    -- المُرسِل يظنّ أنه فشل فيُعيد، وبلا هذا القيد يصير للبضاعة الواحدة عقدان.
    UNIQUE (source, external_ref),

    -- مقبولٌ له إرسالية بلا سبب رفض، ومرفوضٌ له سببٌ بلا إرسالية. ولا ثالث.
    CONSTRAINT offer_outcome_consistent CHECK (
        (status = 'accepted' AND consignment_id IS NOT NULL AND reject_reason IS NULL)
     OR (status = 'rejected' AND consignment_id IS NULL     AND reject_reason IS NOT NULL)
    )
);

CREATE INDEX inbound_offers_by_status ON inbound_offers (status, received_at DESC);

-- أدلّةُ سودجري كما عبرت: مرجعٌ وبصمة.
--
-- `source_ref` مسارٌ في مخزنٍ لا نملكه — يُقرأ ولا يُنقر. والبصمةُ هي ما
-- يجعل «هذه هي الصورة نفسُها» جملةً قابلةً للفحص بعد سنتين.
CREATE TABLE consignment_evidence_refs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consignment_id UUID NOT NULL REFERENCES consignments(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL,               -- 'milestone' · 'land_document' · …
    captured_at    TIMESTAMPTZ,
    latitude       NUMERIC(9,6),
    longitude      NUMERIC(9,6),
    sha256         TEXT NOT NULL,
    source_ref     TEXT NOT NULL,
    CONSTRAINT evidence_hash_shape CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT evidence_lat_range  CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
    CONSTRAINT evidence_lon_range  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    UNIQUE (consignment_id, sha256)
);

COMMENT ON TABLE consignment_evidence_refs IS
  'أدلّةُ المصدر: مرجعٌ وبصمةٌ لا ملفّ. المخزنُ هناك، والحُجّةُ هنا.';

-- ============================================================================
--  ٢) البناء — يرفع استثناءً عند أوّل ما لا يُقبل
-- ----------------------------------------------------------------------------
--  مفصولٌ عن `ingest_offer` عمداً: هذا يرفع، وذاك يمسك ويُسجّل. فلو كانا
--  واحداً لَتَعذّر تسجيلُ الرفض — لأن الاستثناء يُلغي كتابةَ سببه معه.
-- ============================================================================

CREATE FUNCTION build_consignment_from_offer(p jsonb) RETURNS UUID AS $$
DECLARE
    v_corridor   UUID;
    v_commodity  UUID;
    v_grade      UUID;
    v_exporter   UUID;
    v_vendor     UUID;
    v_uom        TEXT;
    v_qty        NUMERIC;
    v_price      BIGINT;
    v_cons       UUID;
    v_ref        TEXT := p->>'external_ref';
    item         jsonb;
BEGIN
    -- (أ) الإذن. سودجري يسأل المزارع قبل النشر، وعرضٌ بلا إذنٍ صريح لا يُدمج.
    --     ولا يُستنتج الإذنُ من الصمت: غيابُ الحقل رفضٌ لا قبول.
    IF coalesce((p->>'consent')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'العرض بلا إذنِ نشرٍ صريح من صاحب السجلّ' USING ERRCODE = 'P0001';
    END IF;

    -- (ب) السلعة والوجهة ⇐ ممرّ. وممرٌّ لا نعرفه رفضٌ لا إنشاء.
    SELECT id INTO v_commodity FROM commodities WHERE code = p->>'commodity' AND is_active;
    IF v_commodity IS NULL THEN
        RAISE EXCEPTION 'سلعةٌ غيرُ معروفة: %', coalesce(p->>'commodity','(غائبة)')
            USING ERRCODE = 'P0001';
    END IF;

    SELECT c.id INTO v_corridor
      FROM corridors c
     WHERE c.commodity_id = v_commodity
       AND c.destination_code = p->>'destination'
       AND c.is_active;
    IF v_corridor IS NULL THEN
        RAISE EXCEPTION 'لا ممرَّ مفعَّلاً من هذه السلعة إلى %',
            coalesce(p->>'destination','(وجهة غائبة)') USING ERRCODE = 'P0001';
    END IF;

    -- (ج) الدرجة — إن ذُكرت وجب أن تكون **درجةَ هذه السلعة**، لا أيَّ درجة.
    IF p ? 'grade' AND p->>'grade' IS NOT NULL THEN
        SELECT id INTO v_grade FROM commodity_grades
         WHERE commodity_id = v_commodity AND code = p->>'grade';
        IF v_grade IS NULL THEN
            RAISE EXCEPTION 'الدرجة % ليست درجةً لهذه السلعة', p->>'grade'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- (د) المصدِّر — يُحَلّ ولا يُنشأ (القاعدة ٢).
    SELECT id, vendor_id INTO v_exporter, v_vendor
      FROM professional_entities
     WHERE code = p->>'exporter_code' AND kind = 'exporter' AND is_active;
    IF v_exporter IS NULL THEN
        RAISE EXCEPTION
            'مصدِّرٌ غيرُ معروفٍ هنا: %. الرخصةُ تُوثَّق في زاديم ولا تُستورد مع العرض',
            coalesce(p->>'exporter_code','(غائب)') USING ERRCODE = 'P0001';
    END IF;
    v_vendor := coalesce(v_vendor, (SELECT id FROM vendors WHERE is_active ORDER BY code LIMIT 1));

    -- (هـ) الكمّية والوحدة والسعر. الكمّيةُ عشريةٌ عبر الحدّ كما هي داخله.
    v_uom := p->>'uom';
    IF NOT EXISTS (SELECT 1 FROM uom WHERE code = v_uom) THEN
        RAISE EXCEPTION 'وحدةُ قياسٍ غيرُ معروفة: %', coalesce(v_uom,'(غائبة)')
            USING ERRCODE = 'P0001';
    END IF;

    v_qty   := (p->>'quantity')::numeric;
    v_price := (p->>'unit_price_minor')::bigint;

    -- (و) الإرسالية — في `draft` دائماً (القاعدة ٣).
    INSERT INTO consignments (
        reference, corridor_id, vendor_id, exporter_entity_id, grade_id,
        quantity, uom_code, unit_price_minor, currency_code, value_minor,
        status
    ) VALUES (
        'SUD-' || v_ref, v_corridor, v_vendor, v_exporter, v_grade,
        v_qty, v_uom, v_price, p->>'currency_code', ROUND(v_qty * v_price),
        'draft'
    ) RETURNING id INTO v_cons;

    -- (ز) المنشأ. قيدُ المضلَّع فوق ٤ هكتارات يسري هنا كما يسري على أي إدخال:
    --     العبورُ من جسرٍ ليس إعفاءً من الحرّاس.
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p->'origins','[]'::jsonb))
    LOOP
        INSERT INTO consignment_origins
            (consignment_id, plot_ref, area_hectares, latitude, longitude, boundary)
        VALUES (v_cons, item->>'plot_ref', (item->>'area_hectares')::numeric,
                (item->>'latitude')::numeric, (item->>'longitude')::numeric,
                item->'boundary');
    END LOOP;

    -- (ح) سلسلةُ العهدة — بترتيبها، وتصير غيرَ قابلةٍ للتعديل فورَ كتابتها.
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p->'custody','[]'::jsonb))
    LOOP
        INSERT INTO custody_events
            (consignment_id, sequence, occurred_at, place_name, latitude, longitude)
        VALUES (v_cons, (item->>'sequence')::integer, (item->>'occurred_at')::timestamptz,
                item->>'place_name', (item->>'latitude')::numeric,
                (item->>'longitude')::numeric);
    END LOOP;

    -- (ط) الأدلّة — مرجعاً وبصمة (القاعدة ٥).
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p->'evidence','[]'::jsonb))
    LOOP
        INSERT INTO consignment_evidence_refs
            (consignment_id, kind, captured_at, latitude, longitude, sha256, source_ref)
        VALUES (v_cons, item->>'kind', (item->>'captured_at')::timestamptz,
                (item->>'latitude')::numeric, (item->>'longitude')::numeric,
                item->>'sha256', item->>'source_ref');
    END LOOP;

    RETURN v_cons;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
--  ٣) الإدماج — يمسك ويُسجّل، ولا يسقط
-- ============================================================================

CREATE FUNCTION ingest_offer(p jsonb) RETURNS UUID AS $$
DECLARE
    v_source TEXT := p->>'source';
    v_ref    TEXT := p->>'external_ref';
    v_offer  UUID;
    v_cons   UUID;
    v_reason TEXT;
BEGIN
    IF v_source IS NULL OR v_ref IS NULL THEN
        RAISE EXCEPTION 'العرض بلا مصدرٍ أو بلا معرّفٍ خارجيّ — لا يمكن تسجيلُه ولا ردُّه'
            USING ERRCODE = 'P0001';
    END IF;

    -- الإدماجُ مرّةً واحدة: العرضُ المعروف يُعاد كما سُجِّل، مقبولاً كان أو
    -- مرفوضاً. والمُرسِلُ الذي يُعيد بعد انقطاعٍ يأخذ الجوابَ نفسَه.
    SELECT id INTO v_offer FROM inbound_offers
     WHERE source = v_source AND external_ref = v_ref;
    IF FOUND THEN
        RETURN v_offer;
    END IF;

    BEGIN
        v_cons := build_consignment_from_offer(p);
    EXCEPTION WHEN OTHERS THEN
        -- كلُّ ما كتبه البناءُ تراجع مع الاستثناء، فلا إرساليةَ نصفَ مبنيّة.
        v_cons   := NULL;
        v_reason := SQLERRM;
    END;

    INSERT INTO inbound_offers
        (source, external_ref, payload, status, reject_reason, consignment_id)
    VALUES (
        v_source, v_ref, p,
        CASE WHEN v_cons IS NULL THEN 'rejected' ELSE 'accepted' END::offer_status,
        v_reason, v_cons
    ) RETURNING id INTO v_offer;

    RETURN v_offer;
END;
$$ LANGUAGE plpgsql;

-- الجسرُ لا يُنشر للمتصفّح: العروضُ تصل من خادمٍ إلى خادم، لا من صفحة.
--
-- والمنعُ غيرُ مشروط — يسري على أي قاعدة. أمّا المنحُ فمشروطٌ بوجود الدور،
-- لأن `service_role` دورُ Supabase ولا وجودَ له في Postgres عارٍ: وبوّابةُ
-- هذا الملفّ تُقلع واحدةً نظيفة، فمنحٌ غيرُ مشروطٍ يُسقط المخطّطَ كلَّه عند
-- سطرٍ إداريّ. والأهمُّ أن الترتيب يبقى صحيحاً في الحالين: المنعُ يقع دائماً،
-- فلا نافذةَ تكون فيها الدالةُ منشورةً بانتظار منحٍ لم يقع.
REVOKE ALL ON FUNCTION ingest_offer(jsonb) FROM public;
REVOKE ALL ON FUNCTION build_consignment_from_offer(jsonb) FROM public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        GRANT EXECUTE ON FUNCTION ingest_offer(jsonb) TO service_role;
    ELSE
        RAISE NOTICE
            'الدور service_role غيرُ موجود — لم يُمنح شيء. متوقَّعٌ خارج Supabase، '
            'ويعني في الإنتاج أن الجسر لا يستطيع أحدٌ مناداته.';
    END IF;
END $$;
