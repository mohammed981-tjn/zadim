import { Module } from "@medusajs/framework/utils";
import FinanceModuleService from "./service";

export const FINANCE_MODULE = "finance";

export default Module(FINANCE_MODULE, {
  service: FinanceModuleService,
});
