import { MedusaService } from "@medusajs/framework/utils";
import { LedgerTransaction, LedgerEntry, LedgerAccount } from "./models";

/**
 * خدمةُ الدفتر — **قراءةٌ ودليلُ حسابات، والكتابةُ في `post.ts`**.
 *
 * لأن الكتابةَ يجب أن تقع في معاملةٍ واحدة كي يعمل قيدُ التوازن
 * المؤجَّل، وذلك يحتاج اتّصالَ القاعدة لا خدمةَ الوحدة.
 */
class LedgerModuleService extends MedusaService({
  LedgerTransaction,
  LedgerEntry,
  LedgerAccount,
}) {
  /** الحساباتُ النشطة — تقرؤها الواجهةُ ولا تُخمَّن. */
  async accounts() {
    return this.listLedgerAccounts({ is_active: true }, { order: { id: "ASC" } });
  }
}

export default LedgerModuleService;
