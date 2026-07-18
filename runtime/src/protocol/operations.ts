import type { JsonValue } from "./types.js";

interface OperationContract { required?: string[]; oneOf?: string[][] }

export const operationContracts: Record<string, OperationContract> = {
  observe: {},
  get_quest_state: {},
  get_market_item: { required: ["id"] },
  find_nearest: { required: ["query"] },
  find_inventory: { oneOf: [["name"], ["id"]] },
  find_ground_item: { oneOf: [["ref"], ["id"], ["name"]] },
  interact_npc: { required: ["action", "expectedRevision"], oneOf: [["ref"], ["id"], ["name"]] },
  interact_object: { required: ["action", "expectedRevision"], oneOf: [["ref"], ["id"], ["name"]] },
  interact_ground_item: { required: ["action", "expectedRevision"], oneOf: [["ref"], ["id"], ["name"]] },
  interact_inventory: { required: ["action", "expectedRevision"], oneOf: [["index"], ["id"], ["name"]] },
  interact_equipment: { required: ["action", "expectedRevision"], oneOf: [["index"], ["id"], ["name"]] },
  use_inventory_on_npc: { required: ["item", "target", "expectedRevision"] },
  use_inventory_on_object: { required: ["item", "target", "expectedRevision"] },
  use_inventory_on_inventory: { required: ["item", "target", "expectedRevision"] },
  interact_interface: { required: ["expectedRevision"], oneOf: [["ref"], ["container", "index"]] },
  walk: { required: ["expectedRevision"], oneOf: [["x", "y"], ["waypoints"]] },
  set_run: { required: ["enabled", "expectedRevision"] },
  dialogue_continue: { required: ["expectedRevision"] },
  dialogue_select: { required: ["number", "text", "expectedRevision"] },
  bank_open: { required: ["expectedRevision"] },
  bank_close: { required: ["expectedRevision"] },
  bank_deposit_inventory: { required: ["expectedRevision"] },
  bank_deposit_item: { required: ["index", "id", "quantity", "expectedRevision"] },
  bank_withdraw: { required: ["quantity", "expectedRevision"], oneOf: [["id"], ["name"]] },
  shop_buy: { required: ["quantity", "expectedRevision"], oneOf: [["id"], ["name"]] },
  shop_sell: { required: ["quantity", "expectedRevision"], oneOf: [["id"], ["name"]] },
  shop_close: { required: ["expectedRevision"] },
  grand_exchange_open: { required: ["expectedRevision"] },
  grand_exchange_buy: { required: ["name", "quantity", "price", "expectedRevision"] },
  grand_exchange_sell: { required: ["name", "quantity", "price", "expectedRevision"] },
  grand_exchange_collect: { required: ["destination", "expectedRevision"] },
  grand_exchange_abort: { required: ["slot", "expectedRevision"] },
  grand_exchange_close: { required: ["expectedRevision"] },
};

export function operationProblems(operation: string, parameters: Record<string, JsonValue> | undefined): string[] {
  const contract = operationContracts[operation];
  if (!contract) return [`unsupported operation '${operation}'`];
  const values = parameters ?? {};
  const problems = (contract.required ?? []).filter((name) => !(name in values)).map((name) => `operation '${operation}' requires '${name}'`);
  if (contract.oneOf && !contract.oneOf.some((group) => group.every((name) => name in values))) {
    problems.push(`operation '${operation}' requires one of: ${contract.oneOf.map((group) => group.join(" + ")).join(", ")}`);
  }
  return problems;
}
