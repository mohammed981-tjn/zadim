import { Module } from "@medusajs/framework/utils";
import OrdersModuleService from "./service";

export const ORDERS_MODULE = "orders";

export default Module(ORDERS_MODULE, {
  service: OrdersModuleService,
});
