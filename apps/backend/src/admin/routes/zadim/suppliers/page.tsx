import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Text, Input, Label, Button, Badge, Table, Textarea } from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Rtl, adminGet, adminPost } from "../../../lib/rtl";

type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  tax_number: string | null;
  active: boolean;
  note: string | null;
};

/**
 * الموردون (بند ٣٢).
 *
 * والاسمُ المطبَّع يحرسه فهرسٌ فريدٌ في الخادم — فمورّدٌ باسمٍ
 * مكرَّرٍ يُرفض بدل أن يُنشئ سجلَّين تتوزّع عليهما المشتريات.
 */
const SuppliersPage = () => {
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [note, setNote] = useState("");

  const load = () =>
    adminGet<{ suppliers: Supplier[] }>("/admin/procurement/suppliers?active=all&limit=200")
      .then((d) => setRows(d.suppliers))
      .catch((e) => setError(String(e.message)));

  useEffect(load, []);

  const create = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await adminPost("/admin/procurement/suppliers", {
        name,
        contact_name: contact || null,
        phone: phone || null,
        email: email || null,
        tax_number: taxNumber || null,
        note: note || null,
      });
      setMessage({ ok: true, text: `أُضيف المورّد ${name}.` });
      setName("");
      setContact("");
      setPhone("");
      setEmail("");
      setTaxNumber("");
      setNote("");
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
          <Heading level="h1">الموردون</Heading>
          <Text className="text-ui-fg-error">تعذّر الجلب ({error}).</Text>
        </Container>
      </Rtl>
    );
  }

  return (
    <Rtl>
      <Container>
        <Heading level="h1">الموردون</Heading>

        <Heading level="h2" style={{ marginTop: 24 }}>
          مورّدٌ جديد
        </Heading>
        <div style={{ display: "grid", gap: 12, maxWidth: 480, marginTop: 12 }}>
          <div>
            <Label htmlFor="name">الاسم *</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="contact">مسؤولُ التواصل</Label>
            <Input id="contact" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="phone">الجوّال</Label>
              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">البريد</Label>
              <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="tax">الرقمُ الضريبيّ</Label>
            <Input id="tax" value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="note">ملاحظة</Label>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div>
            <Button onClick={create} disabled={busy || !name.trim()}>
              {busy ? "جارٍ الإضافة…" : "إضافةُ المورّد"}
            </Button>
          </div>
        </div>

        {message && (
          <Text style={{ marginTop: 12, maxWidth: 480 }} className={message.ok ? "text-ui-fg-subtle" : "text-ui-fg-error"}>
            {message.ok ? "✅ " : "🔴 "}
            {message.text}
          </Text>
        )}

        <Heading level="h2" style={{ marginTop: 32 }}>
          القائمة
        </Heading>
        {!rows && <Text className="text-ui-fg-subtle">جارٍ التحميل…</Text>}
        {rows && rows.length === 0 && <Text className="text-ui-fg-subtle">لا موردين بعد.</Text>}
        {rows && rows.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>الاسم</Table.HeaderCell>
                <Table.HeaderCell>معرّفه (لأمر الشراء)</Table.HeaderCell>
                <Table.HeaderCell>التواصل</Table.HeaderCell>
                <Table.HeaderCell>الحالة</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((s) => (
                <Table.Row key={s.id}>
                  <Table.Cell>{s.name}</Table.Cell>
                  <Table.Cell>
                    <code style={{ fontSize: 12 }}>{s.id}</code>
                  </Table.Cell>
                  <Table.Cell>{[s.contact_name, s.phone, s.email].filter(Boolean).join(" · ") || "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge color={s.active ? "green" : "grey"}>{s.active ? "نشط" : "موقوف"}</Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </Rtl>
  );
};

export const config = defineRouteConfig({ label: "الموردون" });

export default SuppliersPage;
