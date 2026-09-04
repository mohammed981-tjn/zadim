import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Table, Button, Input, Label } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Parcel = {
  id: string;
  barcode: string;
  weight_grams: number;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  pick_list_id: string | null;
  fulfillment_id: string | null;
  created_at: string;
};

/**
 * الطرود — الوزنُ والأبعادُ بعد الإغلاق.
 *
 * ── لماذا الوزنُ بالغرامات صحيحةً ────────────────────────────────
 *
 * نفسُ منطق الهللات (ADR-008): الناقلُ يسعّر بالوزن، وكسرٌ عائمٌ في
 * ٢٫٤ كجم يصير ٢٫٣٩٩٩٩ فيُقرَّب في مكانٍ ويُقطع في آخر. والغرامُ عددٌ
 * صحيحٌ لا يكذب.
 *
 * ── والباركود فريد ───────────────────────────────────────────────
 *
 * الخادمُ يردّ ٤٠٩ على المكرَّر لا يبتلعه. وطردان بباركودٍ واحدٍ يعنيان
 * بوليصةً تشير إلى طردٍ آخر — والشحنةُ تصل غيرَ صاحبها.
 */
const ParcelsPage = () => {
  const [rows, setRows] = useState<Parcel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [barcode, setBarcode] = useState("");
  const [weight, setWeight] = useState("");
  const [len, setLen] = useState("");
  const [wid, setWid] = useState("");
  const [hei, setHei] = useState("");
  const [pickList, setPickList] = useState("");

  const load = () =>
    adminGet<{ parcels: Parcel[] }>("/admin/fulfilment/parcels")
      .then((d) => setRows(d.parcels))
      .catch((e) => setError(String(e.message)));

  useEffect(load, []);

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPost("/admin/fulfilment/parcels", {
        barcode,
        weight_grams: Number(weight),
        length_mm: len === "" ? null : Number(len),
        width_mm: wid === "" ? null : Number(wid),
        height_mm: hei === "" ? null : Number(hei),
        pick_list_id: pickList || null,
      });
      setMessage({ ok: true, text: `سُجّل الطردُ ${barcode}.` });
      setBarcode("");
      setWeight("");
      setLen("");
      setWid("");
      setHei("");
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
          <Heading level="h1">الطرود</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}). تحتاج صلاحية «التغليف».</Text>
        </Container>
      </Rtl>
    );
  }

  const dims = (p: Parcel) =>
    p.length_mm && p.width_mm && p.height_mm ? `${p.length_mm}×${p.width_mm}×${p.height_mm} مم` : "—";

  return (
    <Rtl>
      <Container>
        <Heading level="h1">الطرود</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          يُسجَّل الطردُ **بعد إغلاقه ولصقه** — فوزنُ صندوقٍ مفتوحٍ ليس
          وزنَ ما سيُشحن.
        </Text>

        {message && (
          <Text className={message.ok ? "text-ui-fg-interactive" : "text-ui-fg-error"} style={{ marginTop: 12 }}>
            {message.text}
          </Text>
        )}

        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>الباركود</Table.HeaderCell>
              <Table.HeaderCell>الوزن</Table.HeaderCell>
              <Table.HeaderCell>الأبعاد</Table.HeaderCell>
              <Table.HeaderCell>قائمةُ اللقط</Table.HeaderCell>
              <Table.HeaderCell>الوقت</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {(rows ?? []).map((p) => (
              <Table.Row key={p.id}>
                <Table.Cell>{p.barcode}</Table.Cell>
                <Table.Cell>{(p.weight_grams / 1000).toFixed(3)} كجم</Table.Cell>
                <Table.Cell>{dims(p)}</Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-subtle">{p.pick_list_id ?? "—"}</Text>
                </Table.Cell>
                <Table.Cell>{new Date(p.created_at).toLocaleString("ar-SA")}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        {rows?.length === 0 && (
          <Text className="text-ui-fg-subtle" style={{ marginTop: 8 }}>لا طردَ مسجَّلٌ بعد.</Text>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>تسجيلُ طرد</Heading>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginTop: 12 }}>
          <div><Label size="small">الباركود</Label><Input value={barcode} onChange={(e) => setBarcode(e.target.value)} /></div>
          <div style={{ width: 140 }}><Label size="small">الوزن (غرام)</Label><Input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="2400" /></div>
          <div style={{ width: 110 }}><Label size="small">الطول (مم)</Label><Input value={len} onChange={(e) => setLen(e.target.value)} /></div>
          <div style={{ width: 110 }}><Label size="small">العرض (مم)</Label><Input value={wid} onChange={(e) => setWid(e.target.value)} /></div>
          <div style={{ width: 110 }}><Label size="small">الارتفاع (مم)</Label><Input value={hei} onChange={(e) => setHei(e.target.value)} /></div>
          <div><Label size="small">قائمةُ اللقط (اختياريّ)</Label><Input value={pickList} onChange={(e) => setPickList(e.target.value)} placeholder="pl_…" /></div>
          <Button onClick={create} disabled={busy || !barcode || !weight}>تسجيل</Button>
        </div>
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "الطرود" });

export default ParcelsPage;
