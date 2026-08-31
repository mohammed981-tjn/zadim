import { MedusaService } from "@medusajs/framework/utils";
import { Parcel, PickList, PickListItem, PickTransition, ShipmentEvent } from "./models";
import {
  assignWalkOrder,
  isComplete,
  scanBarcode,
  shortfall,
  type PickItem,
  type ScanResult,
} from "./picking";

/**
 * خدمةُ التنفيذ: اللقطُ والتغليفُ والتتبّع.
 *
 * والمسحُ يمرّ من هنا لا من المسار: **إيقافُ القائمة عند باركودٍ خاطئ
 * أثرٌ يكتب في القاعدة**، ومن يكتبه في مُعالِج مسارٍ ينساه في الثاني.
 */
class FulfilmentModuleService extends MedusaService({
  PickList,
  PickListItem,
  PickTransition,
  Parcel,
  ShipmentEvent,
}) {
  async itemsOf(pickListId: string): Promise<PickItem[]> {
    const rows = await this.listPickListItems(
      { pick_list_id: pickListId },
      { order: { walk_order: "ASC" } }
    );
    return (rows as any[]).map((r) => ({
      id: r.id,
      title: r.title,
      sku: r.sku,
      barcode: r.barcode,
      quantity: Number(r.quantity),
      picked_quantity: Number(r.picked_quantity),
      bin_location: r.bin_location,
      walk_order: Number(r.walk_order),
    }));
  }

  /**
   * مسحةٌ واحدة. والنتيجةُ تُكتب: المقبولةُ تزيد الملقوط، **والخاطئةُ
   * توقف القائمة** بسببها ظاهراً.
   */
  async scan(pickListId: string, barcode: string): Promise<ScanResult> {
    const items = await this.itemsOf(pickListId);
    const result = scanBarcode(items, barcode);

    if (result.accepted) {
      await this.updatePickListItems({
        id: result.item.id,
        picked_quantity: result.picked_quantity,
      });
      return result;
    }

    if (result.blocks) {
      await this.updatePickLists({
        id: pickListId,
        state: "blocked",
        blocked_reason: `باركودٌ خارج القائمة: ${barcode}`,
      });
    }

    return result;
  }

  async complete(pickListId: string) {
    const items = await this.itemsOf(pickListId);
    return { complete: isComplete(items), missing: shortfall(items) };
  }

  /** يُرتّب البنودَ ويكتب `walk_order` — مسيرةٌ واحدةٌ لا ذهابٌ وإياب. */
  async planWalk(pickListId: string) {
    const items = await this.itemsOf(pickListId);
    const ordered = assignWalkOrder(items);
    for (const item of ordered) {
      await this.updatePickListItems({ id: item.id, walk_order: item.walk_order });
    }
    return ordered;
  }

  async transitions() {
    const rows = await this.listPickTransitions({ is_active: true });
    return (rows as any[]).map((r) => ({
      from_state: r.from_state,
      to_state: r.to_state,
      requires_complete: r.requires_complete,
    }));
  }

  // أحداثُ التتبّع تُلحَق ولا تُمسّ: العميلُ قرأها.
  updateShipmentEvents = async (): Promise<never> => {
    throw new Error("[zadim] حدثُ تتبّعٍ وقع لا يُعدَّل — والعميلُ قرأه.");
  };

  deleteShipmentEvents = async (): Promise<never> => {
    throw new Error("[zadim] حدثُ تتبّعٍ وقع لا يُحذف.");
  };
}

export default FulfilmentModuleService;
