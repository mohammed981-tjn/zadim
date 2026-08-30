import { Module } from "@medusajs/framework/utils";
import AccessModuleService from "./service";

export const ACCESS_MODULE = "access";

export default Module(ACCESS_MODULE, {
  service: AccessModuleService,
});
