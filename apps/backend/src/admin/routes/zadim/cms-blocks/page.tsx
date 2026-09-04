import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Badge, Button, Input, Label, Switch, Textarea } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Block = {
  id: string;
  page: string;
  type: string;
  name_ar: string | null;
  position: number;
  is_active: boolean;
  payload: Record<string, unknown> | null;
};

/**
 * كتلُ الصفحات — ما يراه العميلُ على الرئيسية، بترتيبه.
 *
 * ── لماذا الترتيبُ بسهمين لا بسحبٍ وإفلات ─────────────────────────
 *
 * السحبُ يحتاج مكتبةً ثالثةً في لوحةٍ لا تملكها، وحزمةٌ جديدةٌ لأجل
 * ترتيبِ خمسِ كتلٍ ثمنٌ لا يقابله شيء. والسهمان يعطيان النتيجةَ نفسَها
 * ويعملان بلوحة المفاتيح — وهو ما لا يفعله السحبُ أصلاً.
 *
 * ── والمخفيُّ يُعرض ──────────────────────────────────────────────
 *
 * الخادمُ يردّ الكتلَ المطفأةَ أيضاً بقصد: كتلةٌ لا تُرى في اللوحة لا
 * تُشعَل أبداً — تختفي من نظر المدير كما اختفت من نظر العميل، فتبقى
 * مطفأةً إلى الأبد بلا أن يعرف أحدٌ لماذا نقص شيءٌ من الرئيسية.
 */
const CmsBlocksPage = () => {
  const [page, setPage] = useState("home");
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [type, setType] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [payload, setPayload] = useState("{}");
  const [active, setActive] = useState(true);

  const load = (p = page) =>
    adminGet<{ blocks: Block[] }>(`/admin/cms/blocks?page=${encodeURIComponent(p)}`)
      .then((d) => setBlocks(d.blocks))
      .catch((e) => setError(String(e.message)));

  useEffect(() => {
    load(page);
  }, [page]);

  const move = async (index: number, delta: number) => {
    const list = [...(blocks ?? [])];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setBusy(true);
    setMessage(null);
    try {
      await adminPost("/admin/cms/blocks/reorder", { page, ordered_ids: list.map((b) => b.id) });
      setBlocks(list);
      setMessage({ ok: true, text: "أُعيد الترتيب — والعميلُ يراه الآن." });
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
      load();
    }
    setBusy(false);
  };

  const create = async () => {
    setBusy(true);
    setMessage(null);
    let parsed: Record<string, unknown> = {};
    try {
      // ⚠️ JSON يُحلَّل هنا لا يُرسل نصّاً: الخادمُ ينتظر كائناً، ونصٌّ
      // معطوبٌ يصل إليه يُخزَّن حمولةً لا يفهمها العارضُ فتختفي الكتلةُ
      // من الصفحة بلا خطأ.
      parsed = payload.trim() ? JSON.parse(payload) : {};
    } catch {
      setMessage({ ok: false, text: "الحمولةُ ليست JSON صالحة." });
      setBusy(false);
      return;
    }
    try {
      await adminPost("/admin/cms/blocks", { page, type, name_ar: nameAr || null, is_active: active, payload: parsed });
      setMessage({ ok: true, text: "أُضيفت الكتلة." });
      setType("");
      setNameAr("");
      setPayload("{}");
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
          <Heading level="h1">كتلُ الصفحات</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">كتلُ الصفحات</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          نداءٌ واحدٌ هنا يغيّر ما يراه العميلُ في الصفحة الأولى — بلا بناءٍ
          ولا نشر.
        </Text>

        {message && (
          <Text className={message.ok ? "text-ui-fg-interactive" : "text-ui-fg-error"} style={{ marginTop: 12 }}>
            {message.text}
          </Text>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "end", marginTop: 16 }}>
          <div style={{ minWidth: 200 }}>
            <Label size="small">الصفحة</Label>
            <Input value={page} onChange={(e) => setPage(e.target.value)} placeholder="home" />
          </div>
          <Button variant="secondary" onClick={() => load()}>تحديث</Button>
        </div>

        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>الترتيب</Table.HeaderCell>
              <Table.HeaderCell>النوع</Table.HeaderCell>
              <Table.HeaderCell>الاسم</Table.HeaderCell>
              <Table.HeaderCell>الحال</Table.HeaderCell>
              <Table.HeaderCell>الحمولة</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(blocks ?? []).map((b, i) => (
              <Table.Row key={b.id}>
                <Table.Cell>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <Button size="small" variant="secondary" disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</Button>
                    <Button size="small" variant="secondary" disabled={busy || i === (blocks?.length ?? 0) - 1} onClick={() => move(i, 1)}>↓</Button>
                    <Text size="small" className="text-ui-fg-subtle">{b.position}</Text>
                  </div>
                </Table.Cell>
                <Table.Cell><Badge size="2xsmall">{b.type}</Badge></Table.Cell>
                <Table.Cell>{b.name_ar ?? "—"}</Table.Cell>
                <Table.Cell>
                  {b.is_active ? <Badge color="green">ظاهرة</Badge> : <Badge color="orange">مطفأة</Badge>}
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle" style={{ maxWidth: 320, wordBreak: "break-all" }}>
                    {b.payload ? JSON.stringify(b.payload) : "—"}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {blocks?.length === 0 && (
          <Text className="text-ui-fg-subtle" style={{ marginTop: 8 }}>لا كتلةَ في هذه الصفحة.</Text>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>كتلةٌ جديدة</Heading>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginTop: 12 }}>
          <div><Label size="small">النوع</Label><Input value={type} onChange={(e) => setType(e.target.value)} placeholder="hero" /></div>
          <div><Label size="small">الاسم</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="بانر الصفحة" /></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Switch checked={active} onCheckedChange={setActive} id="blk-active" />
            <Label htmlFor="blk-active">ظاهرة</Label>
          </div>
        </div>
        <div style={{ marginTop: 12, maxWidth: 560 }}>
          <Label size="small">الحمولة (JSON)</Label>
          <Textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={4} />
        </div>
        <Button onClick={create} disabled={busy || !type} style={{ marginTop: 12 }}>إضافة</Button>
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "كتلُ الصفحات" });

export default CmsBlocksPage;
