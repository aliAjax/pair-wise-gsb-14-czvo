// 状态编排层（Pinia）：把存储层数据与判定层规则串联起来，供页面调用。
// 所有写操作在此集中处理：批次下发、回执回填、核验冻结、更正建版。
// 已冻结（已核验）的批次、枪项、回执一律拒绝修改；更正只能另建带原因的新版本。

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  evaluateBatch,
  validateDraftItem,
  validateReceipt,
  type RegisterInput
} from "./rules";
import { loadInitialState, localStoragePort } from "./storage";
import type {
  ActivePrice,
  AdjustBatch,
  BatchPrice,
  Conflict,
  DraftNozzleItem,
  FuelType,
  NozzleCheckItem,
  Receipt,
  ResponsibilityType,
  VerificationState
} from "./types";

export interface IssueBatchInput {
  operator: string;
  effectiveDate: string;
  reason: string;
  /** 新挂牌价（按油品）；原价取当前生效价 */
  newPrices: Partial<Record<FuelType, number>>;
  items: RegisterInput[];
}

export interface CorrectBatchInput {
  operator: string;
  effectiveDate: string;
  reason: string; // 本次调价说明
  correctionReason: string; // 更正原因（必填）
  newPrices: Partial<Record<FuelType, number>>;
  items: RegisterInput[];
}

export interface ReceiptInput {
  diffVolume: number | null;
  responsibility: ResponsibilityType | "";
  explanation: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function today(): Date {
  return new Date();
}

export const useVerificationStore = defineStore("verification", () => {
  const state = ref<VerificationState>(loadInitialState(localStoragePort));
  /** 页面选中的批次 */
  const selectedBatchId = ref<string>(state.value.batches[0]?.id ?? "");

  function persist() {
    localStoragePort.save(state.value);
  }

  // ---------- 派生查询（刷新后依据持久化数据重算，判定结果不单独落盘） ----------

  const itemsByBatch = computed(() => {
    const map = new Map<string, NozzleCheckItem[]>();
    for (const item of state.value.items) {
      const list = map.get(item.batchId) ?? [];
      list.push(item);
      map.set(item.batchId, list);
    }
    return map;
  });

  const receiptsByItem = computed(() => {
    const map = new Map<string, Receipt>();
    for (const receipt of state.value.receipts) map.set(receipt.itemId, receipt);
    return map;
  });

  /** 每个批次的判定结果 */
  const evaluations = computed(() => {
    const map = new Map<
      string,
      ReturnType<typeof evaluateBatch> & { conflicts: Conflict[] }
    >();
    for (const batch of state.value.batches) {
      map.set(
        batch.id,
        evaluateBatch(batch, itemsByBatch.value.get(batch.id) ?? [], state.value.receipts, today())
      );
    }
    return map;
  });

  /** 全部批次的冲突，页面按批次、枪号、偏差和规则列出 */
  const allConflicts = computed<Conflict[]>(() =>
    state.value.batches.flatMap((batch) => evaluations.value.get(batch.id)?.conflicts ?? [])
  );

  const selectedBatch = computed<AdjustBatch | undefined>(() =>
    state.value.batches.find((batch) => batch.id === selectedBatchId.value)
  );

  const selectedItems = computed<NozzleCheckItem[]>(
    () => itemsByBatch.value.get(selectedBatchId.value) ?? []
  );

  const selectedEvaluation = computed(() =>
    selectedBatch.value ? evaluations.value.get(selectedBatch.value.id) : undefined
  );

  // ---------- 写操作 ----------

  /** 批次下发前对单条录入做登记校验（供页面逐条提示，保留输入） */
  function checkDraft(
    draft: DraftNozzleItem,
    drafts: DraftNozzleItem[],
    batchId = ""
  ): string | null {
    const existing = batchId ? itemsByBatch.value.get(batchId) ?? [] : [];
    return validateDraftItem(draft, existing, drafts);
  }

  function nextBatchNo(): string {
    state.value.seq += 1;
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
      d.getDate()
    ).padStart(2, "0")}`;
    return `TJ-${ymd}-${String(state.value.seq).padStart(3, "0")}`;
  }

  function buildPrices(newPrices: Partial<Record<FuelType, number>>): BatchPrice[] {
    return state.value.activePrices
      .filter((active) => newPrices[active.fuel] !== undefined)
      .map((active) => ({
        fuel: active.fuel,
        oldPrice: active.price,
        newPrice: Number(newPrices[active.fuel])
      }));
  }

  function assertWritable(batchId: string): AdjustBatch {
    const batch = state.value.batches.find((b) => b.id === batchId);
    if (!batch) throw new Error("批次不存在");
    if (batch.status === "已核验") throw new Error("批次已核验冻结，不能修改；如需更正请另建版本");
    return batch;
  }

  /** 下发调价批次：按油枪生成核验项与空回执，批次从“待复核”开始 */
  function issueBatch(input: IssueBatchInput): AdjustBatch {
    if (!input.operator.trim()) throw new Error("操作员必填");
    if (!input.effectiveDate) throw new Error("拟生效日期必填");
    if (input.items.length === 0) throw new Error("至少登记一条油枪核验项");

    const batch: AdjustBatch = {
      id: uid("batch"),
      batchNo: nextBatchNo(),
      status: "待复核",
      issuedAt: new Date().toISOString(),
      operator: input.operator.trim(),
      effectiveDate: input.effectiveDate,
      reason: input.reason.trim() || "—",
      prices: buildPrices(input.newPrices),
      correctedFromId: "",
      correctionReason: "",
      version: 1,
      frozenAt: ""
    };

    const now = batch.issuedAt;
    const items: NozzleCheckItem[] = input.items.map((row) => ({
      id: uid("item"),
      batchId: batch.id,
      gunNo: row.gunNo.trim(),
      team: row.team as NozzleCheckItem["team"],
      fuel: row.fuel as FuelType,
      indicated: Number(row.indicated),
      measureRead: Number(row.measureRead),
      verifyUntil: row.verifyUntil,
      registeredAt: now
    }));
    const receipts: Receipt[] = items.map((item) => ({
      id: uid("rec"),
      itemId: item.id,
      batchId: batch.id,
      diffVolume: null,
      responsibility: "",
      explanation: "",
      filledAt: ""
    }));

    state.value.batches.unshift(batch);
    state.value.items.push(...items);
    state.value.receipts.push(...receipts);
    selectedBatchId.value = batch.id;
    persist();
    return batch;
  }

  /** 班组回填一条短溢回执（仅待复核批次可填） */
  function fillReceipt(itemId: string, input: ReceiptInput): void {
    const error = validateReceipt(input);
    if (error) throw new Error(error);
    const item = state.value.items.find((i) => i.id === itemId);
    if (!item) throw new Error("核验项不存在");
    assertWritable(item.batchId);

    const receipt = state.value.receipts.find((r) => r.itemId === itemId);
    if (!receipt) throw new Error("回执不存在");
    receipt.diffVolume = Number(input.diffVolume);
    receipt.responsibility = input.responsibility;
    receipt.explanation = input.explanation.trim();
    receipt.filledAt = new Date().toISOString();
    persist();
  }

  /** 核验完成：无阻断冲突且回执全部收回后冻结批次，新挂牌价启用 */
  function freezeBatch(batchId: string): void {
    const batch = assertWritable(batchId);
    const evaluation = evaluations.value.get(batchId);
    if (!evaluation) throw new Error("批次判定缺失");
    if (evaluation.totalItems === 0) throw new Error("批次没有核验项");
    if (evaluation.blockedItems.length > 0) {
      throw new Error("存在检定期过期或偏差超千分之三的枪项，批次须停在待复核");
    }
    if (evaluation.pendingReceiptItems.length > 0) {
      throw new Error(`还有 ${evaluation.pendingReceiptItems.length} 条回执未收回，新挂牌价不得启用`);
    }

    const frozenAt = new Date().toISOString();
    batch.status = "已核验";
    batch.frozenAt = frozenAt;

    // 启用新挂牌价
    for (const price of batch.prices) {
      const active = state.value.activePrices.find((a) => a.fuel === price.fuel);
      const next: ActivePrice = {
        fuel: price.fuel,
        price: price.newPrice,
        sourceBatchId: batch.id,
        since: frozenAt
      };
      if (active) Object.assign(active, next);
      else state.value.activePrices.push(next);
    }
    persist();
  }

  /** 更正已冻结批次：另建带原因的新版本，重新走待复核流程，期间原价继续生效 */
  function correctBatch(sourceId: string, input: CorrectBatchInput): AdjustBatch {
    const source = state.value.batches.find((b) => b.id === sourceId);
    if (!source) throw new Error("原批次不存在");
    if (source.status !== "已核验") throw new Error("只能更正已核验冻结的批次");
    if (!input.correctionReason.trim()) throw new Error("更正原因必填");
    if (input.items.length === 0) throw new Error("至少登记一条油枪核验项");

    const batch: AdjustBatch = {
      id: uid("batch"),
      batchNo: nextBatchNo(),
      status: "待复核",
      issuedAt: new Date().toISOString(),
      operator: input.operator.trim(),
      effectiveDate: input.effectiveDate,
      reason: input.reason.trim() || "—",
      prices: buildPrices(input.newPrices),
      correctedFromId: source.id,
      correctionReason: input.correctionReason.trim(),
      version: source.version + 1,
      frozenAt: ""
    };

    const now = batch.issuedAt;
    const items: NozzleCheckItem[] = input.items.map((row) => ({
      id: uid("item"),
      batchId: batch.id,
      gunNo: row.gunNo.trim(),
      team: row.team as NozzleCheckItem["team"],
      fuel: row.fuel as FuelType,
      indicated: Number(row.indicated),
      measureRead: Number(row.measureRead),
      verifyUntil: row.verifyUntil,
      registeredAt: now
    }));
    const receipts: Receipt[] = items.map((item) => ({
      id: uid("rec"),
      itemId: item.id,
      batchId: batch.id,
      diffVolume: null,
      responsibility: "",
      explanation: "",
      filledAt: ""
    }));

    state.value.batches.unshift(batch);
    state.value.items.push(...items);
    state.value.receipts.push(...receipts);
    selectedBatchId.value = batch.id;
    persist();
    return batch;
  }

  function selectBatch(id: string) {
    selectedBatchId.value = id;
  }

  return {
    state,
    selectedBatchId,
    // 查询
    itemsByBatch,
    receiptsByItem,
    evaluations,
    allConflicts,
    selectedBatch,
    selectedItems,
    selectedEvaluation,
    // 操作
    checkDraft,
    issueBatch,
    fillReceipt,
    freezeBatch,
    correctBatch,
    selectBatch
  };
});
