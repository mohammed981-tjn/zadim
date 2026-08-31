import { Module } from "@medusajs/framework/utils";
import BulkModuleService from "./service";

export const BULK_MODULE = "bulk";

export default Module(BULK_MODULE, {
  service: BulkModuleService,
});
