import { Module } from "@medusajs/framework/utils";
import NotifyModuleService from "./service";

export const NOTIFY_MODULE = "notify";

export default Module(NOTIFY_MODULE, {
  service: NotifyModuleService,
});
