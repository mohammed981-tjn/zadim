import { Module } from "@medusajs/framework/utils";
import LedgerModuleService from "./service";

export const LEDGER_MODULE = "ledger";

export default Module(LEDGER_MODULE, {
  service: LedgerModuleService,
});
