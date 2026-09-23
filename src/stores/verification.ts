// 状态层：承接页面操作，调用判定层规则，通过存储层持久化。
// 所有对批次、枪项、回执的写操作在这里统一拦截：非“待复核”批次一律只读。

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  checkFreezable,
  collectConflicts,
  evaluateBatch,
  type FreezeCheck,
  type NozzleConflict
} from "../domain/rules";
import { loadState, saveState } from "../domain/storage";
import {
  emptyReceipt,
  type AdjustmentBatch,
  type BatchStatus,
  type FuelCode,
  type NozzleDraft,
  type NozzleItem,
  type PriceChange,
  type PriceMap,
  type Receipt,
  type Shift
} from "../domain/types";

export interface DispatchInput {
  issuedBy: string;
  effectiveDate: string;
  lines: Array<{ fuel: FuelCode; newPrice: number }>;
  drafts: NozzleDraft[];
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowLocal(): string {
  return new Date().toISOString();
}

/** 沿更正链找到首发批次 */
function rootBatchOf(batches: AdjustmentBatch[], batch: AdjustmentBatch): AdjustmentBatch {
  let current = batch;
  while (current.sourceBatchId) {
    const parent = batches.find((b) => b.id === current.sourceBatchId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

export const useVerificationStore = defineStore("verification", () => {
  const initial = loadState();
  const prices = ref<PriceMap>(initial.prices);
  const batches = ref<AdjustmentBatch[]>(initial.batches);
  const today = ref(todayLocal());

  function persist() {
    saveState({ schemaVersion: 1, prices: prices.value, batches: batches.value });
  }

  function findBatch(batchId: string): AdjustmentBatch | undefined {
    return batches.value.find((b) => b.id === batchId);
  }

  /** 单批枪项冲突表（itemId → 冲突） */
  const conflictMapByBatch = computed(() => {
    const map = new Map<string, Map<string, NozzleConflict[]>>();
    for (const batch of batches.value) {
      map.set(batch.id, evaluateBatch(batch, today.value));
    }
    return map;
  });

  /** 全局摊平冲突：批次、枪号、偏差、规则 */
  const flatConflicts = computed(() => collectConflicts(batches.value, today.value));

  function conflictsOf(batchId: string) {
    return conflictMapByBatch.value.get(batchId) ?? new Map<string, never>();
  }

  function freezeCheck(batchId: string): FreezeCheck {
    const batch = findBatch(batchId);
    if (!batch) return { ok: false, conflictCount: 0, pendingReceipts: 0, reasons: ["批次不存在"] };
    return checkFreezable(batch, today.value);
  }

  const pendingBatches = computed(() => batches.value.filter((b) => b.status === "待复核"));
  const frozenBatches = computed(() => batches.value.filter((b) => b.status !== "待复核"));

  const metrics = computed(() => ({
    batchTotal: batches.value.length,
    pending: pendingBatches.value.length,
    frozen: batches.value.filter((b) => b.status === "已冻结").length,
    revised: batches.value.filter((b) => b.status === "已更正").length,
    conflicts: flatConflicts.value.length,
    pendingReceipts: pendingBatches.value.reduce(
      (sum, b) => sum + b.items.filter((i) => i.receipt.filledAt == null).length,
      0
    )
  }));

  /** 某油品当前生效价（冻结时才会被新价替换） */
  function currentPriceOf(fuel: FuelCode): number {
    return prices.value[fuel].price;
  }

  function nextBatchNo(): string {
    const stamp = today.value.split("-").join("");
    const count = batches.value.filter((b) => b.batchNo.startsWith(`TJ-${stamp}-`)).length + 1;
    return `TJ-${stamp}-${String(count).padStart(2, "0")}`;
  }

  /** 调价下发：按油枪生成核验项，整批进入待复核（输入原样保留） */
  function dispatch(input: DispatchInput): ActionResult {
    if (input.issuedBy.trim() === "" || input.effectiveDate === "") {
      return { ok: false, message: "请填写下发人和拟生效日期" };
    }
    const changes: PriceChange[] = input.lines
      .filter((line) => Number.isFinite(line.newPrice) && line.newPrice > 0)
      .map((line) => ({
        fuel: line.fuel,
        oldPrice: currentPriceOf(line.fuel),
        newPrice: line.newPrice
      }));
    if (changes.length < input.lines.length) {
      return { ok: false, message: "勾选的油品都需填写有效的新挂牌价（大于 0）" };
    }
    if (changes.length === 0) {
      return { ok: false, message: "至少选择一种油品并填写新挂牌价" };
    }
    const drafts = input.drafts.filter(
      (d) =>
        d.nozzleNo.trim() !== "" ||
        d.shift !== "" ||
        d.indication != null ||
        d.measureTank != null ||
        d.verifiedUntil !== ""
    );
    if (drafts.length === 0) {
      return { ok: false, message: "至少登记一条油枪核验项" };
    }

    const items: NozzleItem[] = drafts.map((draft) => ({
      id: crypto.randomUUID(),
      nozzleNo: draft.nozzleNo.trim(),
      shift: draft.shift,
      indication: draft.indication,
      measureTank: draft.measureTank,
      verifiedUntil: draft.verifiedUntil,
      receipt: emptyReceipt()
    }));

    const batch: AdjustmentBatch = {
      id: crypto.randomUUID(),
      batchNo: nextBatchNo(),
      version: 1,
      sourceBatchId: null,
      correctionReason: "",
      revisedByBatchId: null,
      issuedAt: nowLocal(),
      issuedBy: input.issuedBy.trim(),
      effectiveDate: input.effectiveDate,
      changes,
      items,
      status: "待复核",
      frozenAt: null
    };
    batches.value = [batch, ...batches.value];
    persist();
    return { ok: true, message: `已下发 ${batch.batchNo}，生成 ${items.length} 条油枪核验项` };
  }

  function updateItem(
    batchId: string,
    itemId: string,
    patch: Partial<Pick<NozzleItem, "nozzleNo" | "shift" | "indication" | "measureTank" | "verifiedUntil">>
  ): ActionResult {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "待复核") {
      return { ok: false, message: "批次已冻结，只能通过更正产生新版本" };
    }
    const target = batch.items.find((i) => i.id === itemId);
    if (!target) return { ok: false, message: "核验项不存在" };
    Object.assign(target, patch);
    persist();
    return { ok: true, message: "已保留输入" };
  }

  /** 班组回填短溢回执；三项齐全即记录收回时间，缺项则自动回到未收回 */
  function saveReceipt(batchId: string, itemId: string, patch: Partial<Receipt>): ActionResult {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "待复核") {
      return { ok: false, message: "批次已冻结，回执不可修改" };
    }
    const target = batch.items.find((i) => i.id === itemId);
    if (!target) return { ok: false, message: "核验项不存在" };

    const next: Receipt = { ...target.receipt, ...patch };
    const complete =
      next.diffQty != null && next.responsibility !== "" && next.note.trim() !== "";
    target.receipt = {
      ...next,
      note: next.note,
      filledAt: complete ? target.receipt.filledAt ?? nowLocal() : null
    };
    persist();
    return { ok: true, message: complete ? "回执已收回" : "回执尚未填全，仍计为未收回" };
  }

  function addItem(batchId: string): ActionResult {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "待复核") {
      return { ok: false, message: "只有待复核批次可以补登油枪" };
    }
    batch.items.push({
      id: crypto.randomUUID(),
      nozzleNo: "",
      shift: "",
      indication: null,
      measureTank: null,
      verifiedUntil: "",
      receipt: emptyReceipt()
    });
    persist();
    return { ok: true, message: "已新增核验项" };
  }

  function removeItem(batchId: string, itemId: string): ActionResult {
    const batch = findBatch(batchId);
    if (!batch || batch.status !== "待复核") {
      return { ok: false, message: "批次已冻结，核验项不可删除" };
    }
    batch.items = batch.items.filter((i) => i.id !== itemId);
    persist();
    return { ok: true, message: "已移除核验项" };
  }

  /** 冻结：无冲突且回执全部收回时，批次连同枪项、回执一起冻结，新挂牌价启用 */
  function freeze(batchId: string): ActionResult {
    const batch = findBatch(batchId);
    if (!batch) return { ok: false, message: "批次不存在" };
    if (batch.status !== "待复核") return { ok: false, message: "批次不在待复核状态" };

    const check = checkFreezable(batch, today.value);
    if (!check.ok) return { ok: false, message: check.reasons.join("；") };

    for (const change of batch.changes) {
      prices.value[change.fuel] = {
        fuel: change.fuel,
        price: change.newPrice,
        batchId: batch.id,
        updatedAt: nowLocal()
      };
    }
    batch.status = "已冻结" as BatchStatus;
    batch.frozenAt = nowLocal();
    persist();
    return { ok: true, message: `${batch.batchNo} 复核完成并冻结，新挂牌价已启用` };
  }

  /** 更正：对已冻结批次另建带原因的新版本，重新逐枪核验 */
  function correct(sourceId: string, reason: string): ActionResult {
    const source = findBatch(sourceId);
    if (!source) return { ok: false, message: "原批次不存在" };
    if (source.status !== "已冻结") {
      return { ok: false, message: "只有已冻结批次可以更正" };
    }
    if (reason.trim() === "") return { ok: false, message: "请填写更正原因" };

    const root = rootBatchOf(batches.value, source);
    const family = batches.value.filter((b) => rootBatchOf(batches.value, b).id === root.id);
    const version = Math.max(...family.map((b) => b.version)) + 1;
    const newId = crypto.randomUUID();

    const copy: AdjustmentBatch = {
      ...source,
      id: newId,
      version,
      sourceBatchId: source.id,
      correctionReason: reason.trim(),
      revisedByBatchId: null,
      issuedAt: nowLocal(),
      items: source.items.map((i) => ({
        id: crypto.randomUUID(),
        nozzleNo: i.nozzleNo,
        shift: i.shift,
        indication: null,
        measureTank: null,
        verifiedUntil: "",
        receipt: emptyReceipt()
      })),
      status: "待复核",
      frozenAt: null
    };

    // 原批次冻结态保留，仅顶层状态标记为已更正（深内容不动）
    const replaced: AdjustmentBatch = { ...source, status: "已更正", revisedByBatchId: newId };
    batches.value = batches.value.map((b) => (b.id === source.id ? replaced : b));
    batches.value = [copy, ...batches.value];
    persist();
    return { ok: true, message: `已生成 ${root.batchNo} 的 v${version} 更正版本` };
  }

  return {
    prices,
    batches,
    today,
    flatConflicts,
    pendingBatches,
    frozenBatches,
    metrics,
    currentPriceOf,
    conflictsOf,
    freezeCheck,
    dispatch,
    updateItem,
    saveReceipt,
    addItem,
    removeItem,
    freeze,
    correct
  };
});

export type { Shift };
