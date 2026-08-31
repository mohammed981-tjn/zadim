import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import PickupFulfillmentService from "./service";

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [PickupFulfillmentService],
});
