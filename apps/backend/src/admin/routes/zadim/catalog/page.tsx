import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Badge, Button, Input, Label, Select, Switch } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Attribute = { id: string; code: string; name_ar: string; name_en: string | null; data_type: string; is_filterable: boolean };
type Seo = { id: string; entity: string; entity_id: string; locale: string | null; title: string | null; description: string | null; no_index: boolean };
type Redirect = { id: string; from_path: string; to_path: string; hits: number; status_code?: number };
type Synonym = { id: string; term: string; synonyms: string[] };
type Translation = { id: string; entity_type: string; entity_id: string; field: string; locale: string; value: string };

type Section = "attributes" | "seo" | "redirects" | "synonyms" | "translations";

/**
 * الكتالوج — خمسُ وحداتٍ في شاشةٍ واحدة.
 *
 * ── لماذا واحدةٌ لا خمس ───────────────────────────────────────────
 *
 * لأنها خمسةُ **جوانبَ لشيءٍ واحد**: كيف يُوصَف المنتجُ ويُوجَد. ومن
 * يضيف مرادفَ بحثٍ هو من يضبط عنوانَ الصفحة ومن يكتب التحويلَ حين
 * يتغيّر الرابط. وخمسُ مداخلَ في القائمة الجانبية تدفن الأربعَ الباقيةَ
 * تحت الأولى.
 *
 * ── وما لا يوجد هنا: الحذف ────────────────────────────────────────
 *
 * لا مسارَ خلفيَّ يحذف من هذه الوحدات (`GET` و`POST` فقط)، فلا زرَّ
 * حذفٍ يُعرض. **وزرٌّ يعد بما لا يقع أسوأُ من غيابه**: يضغطه المديرُ
 * فيرى خطأً غامضاً ويظنّ العطبَ في بياناته.
 */
const CatalogPage = () => {
  const [section, setSection] = useState<Section>("attributes");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [seo, setSeo] = useState<Seo[]>([]);
  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);
  const [translations, setTranslations] = useState<Translation[]>([]);

  // خاصية
  const [attCode, setAttCode] = useState("");
  const [attNameAr, setAttNameAr] = useState("");
  const [attType, setAttType] = useState("text");
  const [attFilterable, setAttFilterable] = useState(true);

  // SEO
  const [seoEntity, setSeoEntity] = useState("product");
  const [seoId, setSeoId] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDesc, setSeoDesc] = useState("");
  const [seoNoIndex, setSeoNoIndex] = useState(false);

  // تحويل
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // مرادفات
  const [term, setTerm] = useState("");
  const [syns, setSyns] = useState("");

  // ترجمة
  const [trType, setTrType] = useState("product");
  const [trId, setTrId] = useState("");
  const [trField, setTrField] = useState("title");
  const [trLocale, setTrLocale] = useState("en");
  const [trValue, setTrValue] = useState("");

  const load = () => {
    adminGet<{ attributes: Attribute[] }>("/admin/catalog/attributes").then((d) => setAttributes(d.attributes)).catch((e) => setError(String(e.message)));
    adminGet<{ seo_meta: Seo[] }>("/admin/catalog/seo").then((d) => setSeo(d.seo_meta)).catch(() => setSeo([]));
    adminGet<{ redirects: Redirect[] }>("/admin/catalog/redirects").then((d) => setRedirects(d.redirects)).catch(() => setRedirects([]));
    adminGet<{ synonyms: Synonym[] }>("/admin/catalog/synonyms").then((d) => setSynonyms(d.synonyms)).catch(() => setSynonyms([]));
    adminGet<{ translations: Translation[] }>("/admin/catalog/translations").then((d) => setTranslations(d.translations)).catch(() => setTranslations([]));
  };

  useEffect(load, []);

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: okText });
      load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
    setBusy(false);
  };

  if (error) {
    return (
      <Rtl>
        <Container>
          <Heading level="h1">الكتالوج</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}). تحتاج صلاحية «قراءة المنتجات».</Text>
        </Container>
      </Rtl>
    );
  }

  const TABS: Array<{ key: Section; label: string; n: number }> = [
    { key: "attributes", label: "الخصائص", n: attributes.length },
    { key: "seo", label: "SEO", n: seo.length },
    { key: "redirects", label: "التحويلات", n: redirects.length },
    { key: "synonyms", label: "المرادفات", n: synonyms.length },
    { key: "translations", label: "الترجمات", n: translations.length },
  ];

  return (
    <Rtl>
      <Container>
        <Heading level="h1">الكتالوج</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          كيف يُوصَف المنتجُ وكيف يُوجَد. والحذفُ غيرُ متاحٍ لأن المسارَ
          الخلفيَّ لا يملكه.
        </Text>

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <Button
              key={t.key}
              size="small"
              variant={section === t.key ? "primary" : "secondary"}
              onClick={() => setSection(t.key)}
            >
              {t.label} ({t.n})
            </Button>
          ))}
        </div>

        {message && (
          <Text className={message.ok ? "text-ui-fg-interactive" : "text-ui-fg-error"} style={{ marginTop: 12 }}>
            {message.text}
          </Text>
        )}

        {section === "attributes" && (
          <>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>الرمز</Table.HeaderCell>
                  <Table.HeaderCell>الاسم</Table.HeaderCell>
                  <Table.HeaderCell>النوع</Table.HeaderCell>
                  <Table.HeaderCell>يُرشَّح به</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {attributes.map((a) => (
                  <Table.Row key={a.id}>
                    <Table.Cell>{a.code}</Table.Cell>
                    <Table.Cell>{a.name_ar}{a.name_en && ` — ${a.name_en}`}</Table.Cell>
                    <Table.Cell><Badge size="2xsmall">{a.data_type}</Badge></Table.Cell>
                    <Table.Cell>{a.is_filterable ? "نعم" : "لا"}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginTop: 16 }}>
              <div><Label size="small">الرمز</Label><Input value={attCode} onChange={(e) => setAttCode(e.target.value)} placeholder="color" /></div>
              <div><Label size="small">الاسم بالعربية</Label><Input value={attNameAr} onChange={(e) => setAttNameAr(e.target.value)} placeholder="اللون" /></div>
              <div style={{ minWidth: 160 }}>
                <Label size="small">النوع</Label>
                <Select value={attType} onValueChange={setAttType}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="text">نصّ</Select.Item>
                    <Select.Item value="number">رقم</Select.Item>
                    <Select.Item value="boolean">نعم/لا</Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Switch checked={attFilterable} onCheckedChange={setAttFilterable} id="att-f" />
                <Label htmlFor="att-f">يُرشَّح به</Label>
              </div>
              <Button
                disabled={busy || !attCode || !attNameAr}
                onClick={() =>
                  run(
                    () => adminPost("/admin/catalog/attributes", { code: attCode, name_ar: attNameAr, data_type: attType, is_filterable: attFilterable }),
                    "أُضيفت الخاصية."
                  ).then(() => { setAttCode(""); setAttNameAr(""); })
                }
              >
                إضافة
              </Button>
            </div>
          </>
        )}

        {section === "seo" && (
          <>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>الكيان</Table.HeaderCell>
                  <Table.HeaderCell>العنوان</Table.HeaderCell>
                  <Table.HeaderCell>الوصف</Table.HeaderCell>
                  <Table.HeaderCell>يُفهرَس</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {seo.map((s) => (
                  <Table.Row key={s.id}>
                    <Table.Cell>
                      {s.entity}
                      <Text size="small" className="text-ui-fg-subtle">{s.entity_id}</Text>
                    </Table.Cell>
                    <Table.Cell>{s.title ?? "—"}</Table.Cell>
                    <Table.Cell><Text size="small" style={{ maxWidth: 280 }}>{s.description ?? "—"}</Text></Table.Cell>
                    <Table.Cell>{s.no_index ? <Badge color="red">لا</Badge> : "نعم"}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginTop: 16 }}>
              <div style={{ minWidth: 140 }}>
                <Label size="small">الكيان</Label>
                <Select value={seoEntity} onValueChange={setSeoEntity}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="product">منتج</Select.Item>
                    <Select.Item value="category">تصنيف</Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div><Label size="small">المعرّف</Label><Input value={seoId} onChange={(e) => setSeoId(e.target.value)} placeholder="prod_…" /></div>
              <div><Label size="small">العنوان</Label><Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} /></div>
              <div><Label size="small">الوصف</Label><Input value={seoDesc} onChange={(e) => setSeoDesc(e.target.value)} /></div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Switch checked={seoNoIndex} onCheckedChange={setSeoNoIndex} id="seo-ni" />
                <Label htmlFor="seo-ni">امنعِ الفهرسة</Label>
              </div>
              <Button
                disabled={busy || !seoId}
                onClick={() =>
                  run(
                    () => adminPost("/admin/catalog/seo", { entity: seoEntity, entity_id: seoId, title: seoTitle || null, description: seoDesc || null, no_index: seoNoIndex }),
                    "حُفظ الوصف."
                  )
                }
              >
                حفظ
              </Button>
            </div>
          </>
        )}

        {section === "redirects" && (
          <>
            <Text size="small" className="text-ui-fg-subtle">
              مرتَّبةٌ بعدد الطَّرقات — فالأكثرُ طرقاً هو الرابطُ المكسور
              الذي يكلّف فعلاً.
            </Text>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>من</Table.HeaderCell>
                  <Table.HeaderCell>إلى</Table.HeaderCell>
                  <Table.HeaderCell>الطَّرقات</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {redirects.map((r) => (
                  <Table.Row key={r.id}>
                    <Table.Cell>{r.from_path}</Table.Cell>
                    <Table.Cell>{r.to_path}</Table.Cell>
                    <Table.Cell>{r.hits}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            <div style={{ display: "flex", gap: 12, alignItems: "end", marginTop: 16 }}>
              <div><Label size="small">من</Label><Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="/old-path" /></div>
              <div><Label size="small">إلى</Label><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="/new-path" /></div>
              <Button
                disabled={busy || !from || !to}
                onClick={() => run(() => adminPost("/admin/catalog/redirects", { from_path: from, to_path: to }), "أُضيف التحويل.").then(() => { setFrom(""); setTo(""); })}
              >
                إضافة
              </Button>
            </div>
          </>
        )}

        {section === "synonyms" && (
          <>
            <Text size="small" className="text-ui-fg-subtle">
              من يبحث «جوال» يجب أن يجد «هاتف». والمرادفاتُ بيانات لا كود.
            </Text>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>الكلمة</Table.HeaderCell>
                  <Table.HeaderCell>مرادفاتُها</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {synonyms.map((s) => (
                  <Table.Row key={s.id}>
                    <Table.Cell>{s.term}</Table.Cell>
                    <Table.Cell>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {(s.synonyms ?? []).map((x) => <Badge key={x} size="2xsmall">{x}</Badge>)}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            <div style={{ display: "flex", gap: 12, alignItems: "end", marginTop: 16 }}>
              <div><Label size="small">الكلمة</Label><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="هاتف" /></div>
              <div style={{ minWidth: 280 }}>
                <Label size="small">المرادفات (تفصلها فاصلة)</Label>
                <Input value={syns} onChange={(e) => setSyns(e.target.value)} placeholder="جوال، موبايل" />
              </div>
              <Button
                disabled={busy || !term || !syns.trim()}
                onClick={() =>
                  run(
                    () => adminPost("/admin/catalog/synonyms", { term, synonyms: syns.split(/[,،]/).map((s) => s.trim()).filter(Boolean) }),
                    "أُضيفت المرادفات."
                  ).then(() => { setTerm(""); setSyns(""); })
                }
              >
                إضافة
              </Button>
            </div>
          </>
        )}

        {section === "translations" && (
          <>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>الكيان</Table.HeaderCell>
                  <Table.HeaderCell>الحقل</Table.HeaderCell>
                  <Table.HeaderCell>اللغة</Table.HeaderCell>
                  <Table.HeaderCell>القيمة</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {translations.map((t) => (
                  <Table.Row key={t.id}>
                    <Table.Cell>
                      {t.entity_type}
                      <Text size="small" className="text-ui-fg-subtle">{t.entity_id}</Text>
                    </Table.Cell>
                    <Table.Cell>{t.field}</Table.Cell>
                    <Table.Cell><Badge size="2xsmall">{t.locale}</Badge></Table.Cell>
                    <Table.Cell><Text size="small" style={{ maxWidth: 320 }}>{t.value}</Text></Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
            <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginTop: 16 }}>
              <div style={{ minWidth: 140 }}>
                <Label size="small">الكيان</Label>
                <Select value={trType} onValueChange={setTrType}>
                  <Select.Trigger><Select.Value /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="product">منتج</Select.Item>
                    <Select.Item value="category">تصنيف</Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div><Label size="small">المعرّف</Label><Input value={trId} onChange={(e) => setTrId(e.target.value)} placeholder="prod_…" /></div>
              <div><Label size="small">الحقل</Label><Input value={trField} onChange={(e) => setTrField(e.target.value)} /></div>
              <div style={{ width: 100 }}><Label size="small">اللغة</Label><Input value={trLocale} onChange={(e) => setTrLocale(e.target.value)} /></div>
              <div style={{ minWidth: 240 }}><Label size="small">القيمة</Label><Input value={trValue} onChange={(e) => setTrValue(e.target.value)} /></div>
              <Button
                disabled={busy || !trId || !trField || !trLocale || !trValue}
                onClick={() =>
                  run(
                    () => adminPost("/admin/catalog/translations", { entity_type: trType, entity_id: trId, field: trField, locale: trLocale, value: trValue }),
                    "حُفظت الترجمة."
                  ).then(() => setTrValue(""))
                }
              >
                حفظ
              </Button>
            </div>
          </>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "الكتالوج" });

export default CatalogPage;
