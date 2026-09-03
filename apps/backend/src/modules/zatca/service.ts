import { MedusaService } from "@medusajs/framework/utils";
import { randomUUID } from "crypto";
import { ZatcaInvoice, ZatcaSetting } from "./models";
import { buildQrTlv } from "./tlv";
import { FIRST_SEQUENCE, genesisHash, invoiceHash, verifyChain, type ChainRow } from "./chain";

export type IssueInput = {
  order_id: string;
  issued_at?: Date;
  currency_code: string;
  /** بالهللات، شاملاً الضريبة. */
  total: number;
  /** بالهللات. */
  vat_total: number;
  buyer?: { name?: string | null; vat_number?: string | null; address?: unknown } | null;
  lines: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    vat_rate: number;
    line_total: number;
    vat_amount: number;
  }>;
};

export type IssueResult =
  | { issued: true; invoice: any }
  | { issued: false; code: "ZATCA_NOT_CONFIGURED" | "ALREADY_ISSUED"; reason_ar: string; invoice?: any };

/**
 * خدمةُ الفوترة الإلكترونية.
 *
 * ── الإصدارُ يُسلسَل، ولا يُترك للتزاحم ─────────────────────────
 *
 * تسلسلٌ «غيرُ منقطع» يعني أن قارئين متزامنين لا يجوز أن يقرآ نفسَ
 * الرقم. فالإصدارُ كلُّه داخل معاملةٍ تبدأ بـ**قفلٍ استشاريّ** على اسم
 * الجدول: الثاني ينتظر فيقرأ رقماً محدَّثاً لا قديماً.
 *
 * وهو نفسُ الدرس الذي كلّفنا المرحلةَ الثالثة: القراءةُ-ثم-الكتابة بلا
 * قفلٍ تعطي أربعةً وتسعين حجزاً على مخزونِ عشرة. **والفواتيرُ أسوأ**:
 * المخزونُ يُصحَّح، والفجوةُ في تسلسل الفواتير تُفسَّر للهيئة.
 *
 * ── ولا تُصدَر فاتورةٌ بلا إعدادات ──────────────────────────────
 *
 * رقمٌ ضريبيٌّ وهميّ في رمزٍ يُطبع على فاتورةٍ تصل الهيئة. فالغيابُ
 * **يمنع** ولا يملأ الفراغ.
 */
/**
 * 🔴 اسمُ الجدول **بمخطَّطه المضبوط**، لا بـ`"zadim."` مكتوبةً.
 *
 * كان مكتوباً حرفياً في أربعة مواضع هنا، و`medusa-config.ts` يقرؤه من
 * `DATABASE_SCHEMA`. فمن يضبط المتغيّر بغير `zadim` — وهو أوّلُ ما
 * يخطر عند الانتقال إلى قاعدةٍ خاصّة — يجد **الفوترةَ وحدَها تسقط**
 * بـ«relation does not exist»، وكلَّ شيءٍ آخرَ يعمل. وأسوأُ ما فيه أنه
 * يسقط في **إصدار الفاتورة**: الطلبُ يمرّ، والفاتورةُ لا تُختم، والفجوةُ
 * لا تُسدّ بأثرٍ رجعيّ (ADR-020).
 *
 * ولا يُقرأ المتغيّرُ عند كل نداء: قيمتُه لا تتغيّر في عمر العملية.
 */
const SCHEMA = process.env.DATABASE_SCHEMA || "zadim";
const INVOICE_TABLE = `${SCHEMA}.zadim_zatca_invoice`;

class ZatcaModuleService extends MedusaService({ ZatcaSetting, ZatcaInvoice }) {
  protected readonly pg_: any;

  constructor(container: any) {
    // التمريرُ إلى الصنف المولَّد كما يفعله Medusa نفسُه.
    super(...arguments);
    this.pg_ = container.__pg_connection__;
  }

  async settings() {
    const [row] = await this.listZatcaSettings({}, { take: 1 });
    return row ?? null;
  }

  async isConfigured(): Promise<boolean> {
    const s: any = await this.settings();
    return Boolean(s && s.is_enabled && s.seller_name && s.vat_number);
  }

  /**
   * يُصدر فاتورةً للطلب، أو يشرح لماذا لم يُصدر.
   *
   * ⚠️ **ولا يرمي عند غياب الإعدادات**: منعُ إتمام طلبٍ لأن المالك لم
   * يملأ استمارةَ ZATCA بعدُ يوقف المتجرَ لسببٍ إداريّ. يُعاد الحكمُ
   * صريحاً، ويقرّر المُنادي.
   */
  async issue(input: IssueInput): Promise<IssueResult> {
    const settings: any = await this.settings();

    if (!settings || !settings.is_enabled || !settings.seller_name || !settings.vat_number) {
      return {
        issued: false,
        code: "ZATCA_NOT_CONFIGURED",
        reason_ar:
          "لم تُضبط إعداداتُ الفوترة الإلكترونية (اسمُ البائع والرقمُ الضريبيّ) — لا تُصدَر فاتورةٌ ببياناتٍ ناقصة.",
      };
    }

    const [existing] = await this.listZatcaInvoices({ order_id: input.order_id });
    if (existing) {
      return {
        issued: false,
        code: "ALREADY_ISSUED",
        reason_ar: "لهذا الطلب فاتورةٌ صادرةٌ من قبل.",
        invoice: existing,
      };
    }

    const issuedAt = input.issued_at ?? new Date();
    const uuid = randomUUID();

    return await this.pg_.transaction(async (trx: any) => {
      // 🔴 القفلُ يُسلسل المُصدِرين. وبلا هذا يقرأ اثنان نفسَ الرقم
      // فيُنتجان تكراراً — أو فجوةً حين يسقط أحدُهما.
      await trx.raw(`select pg_advisory_xact_lock(hashtext('zadim_zatca_invoice'))`);

      const last = await trx(INVOICE_TABLE)
        .whereNull("deleted_at")
        .orderBy("sequence", "desc")
        .first();

      // رقمُ البداية من `chain.ts` لا رقمٌ مكتوبٌ هنا: الفاحصُ يقارن به،
      // ورقمان في موضعين يفترقان يوماً فيُصدر الخادمُ ما يرفضه فاحصُه.
      const sequence = last ? Number(last.sequence) + 1 : FIRST_SEQUENCE;
      const previous_hash = last ? String(last.invoice_hash) : genesisHash();

      const payload = {
        uuid,
        sequence,
        order_id: input.order_id,
        issued_at: issuedAt.toISOString(),
        currency_code: input.currency_code,
        total: input.total,
        vat_total: input.vat_total,
        seller: {
          name: settings.seller_name,
          vat_number: settings.vat_number,
          address: {
            street: settings.address_street ?? null,
            district: settings.address_district ?? null,
            city: settings.address_city ?? null,
            postal_code: settings.address_postal_code ?? null,
            building_number: settings.address_building_number ?? null,
          },
          commercial_registration: settings.commercial_registration ?? null,
        },
        buyer: input.buyer ?? null,
        lines: input.lines,
      };

      const hash = invoiceHash(previous_hash, payload);
      const qr = buildQrTlv({
        seller_name: settings.seller_name,
        vat_number: settings.vat_number,
        timestamp: issuedAt.toISOString(),
        total_halalas: input.total,
        vat_halalas: input.vat_total,
      });

      const id = `zinv_${uuid.replace(/-/g, "")}`;
      await trx(INVOICE_TABLE).insert({
        id,
        sequence,
        uuid,
        order_id: input.order_id,
        issued_at: issuedAt,
        currency_code: input.currency_code,
        total: input.total,
        vat_total: input.vat_total,
        payload: JSON.stringify(payload),
        previous_hash,
        invoice_hash: hash,
        qr_base64: qr,
        status: "issued",
      });

      const invoice = await trx(INVOICE_TABLE).where({ id }).first();
      return { issued: true, invoice };
    });
  }

  /** يفحص السلسلةَ **كاملةً** — لا آخرَ صفٍّ وحده. */
  async verify(): Promise<ReturnType<typeof verifyChain> & { count: number }> {
    const rows = await this.listZatcaInvoices({}, { order: { sequence: "ASC" } });
    const mapped: ChainRow[] = (rows as any[]).map((r) => ({
      sequence: Number(r.sequence),
      previous_hash: r.previous_hash,
      invoice_hash: r.invoice_hash,
      payload: r.payload,
    }));
    return { ...verifyChain(mapped), count: mapped.length };
  }

  // الفاتورةُ الصادرة لا تُعدَّل ولا تُحذف — والقاعدةُ تمنعهما أيضاً.
  // وما يُحدَّث هو حالةُ الإبلاغ وحدَها، ولها دالّتُها.
  deleteZatcaInvoices = async (): Promise<never> => {
    throw new Error("[zadim] فاتورةٌ صادرة لا تُحذف — والفجوةُ في التسلسل تُفسَّر للهيئة.");
  };

  /** حالةُ الإبلاغ من المزوّد المعتمد — الحقلُ الوحيد الذي يتغيّر بعد الإصدار. */
  async recordReporting(id: string, status: "reported" | "cleared" | "failed", ref?: string | null, error?: string | null) {
    await this.pg_(INVOICE_TABLE)
      .where({ id })
      .update({ status, provider_ref: ref ?? null, last_error: error ?? null, updated_at: new Date() });
  }
}

export default ZatcaModuleService;
