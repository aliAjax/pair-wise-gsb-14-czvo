// 判定层：核验规则全部集中在本文件，均为纯函数。
// 规则：
//  1. 同枪同班只能一条（批次内重复）——登记前直接拒收。
//  2. 检定期已过——阻断：整批停在待复核。
//  3. 示值相对偏差超过千分之三（|示值-计量罐读数|/计量罐读数 > 3‰）——阻断：整批停在待复核。
//  4. 回执未全部收回（补差量、责任类型、说明齐全）——新挂牌价不得启用，原价继续生效。

import type {
  BatchStatus,
  Conflict,
  DraftNozzleItem,
  NozzleCheckItem,
  Receipt,
  ResponsibilityType
} from "./types";

/** 允许的最大示值相对偏差：千分之三 */
export const MAX_DEVIATION_PER_MILLE = 3;

/** 参与判定的最小登记字段（登记时用） */
export interface RegisterInput {
  gunNo: string;
  team: string;
  fuel: string;
  indicated: number;
  measureRead: number;
  verifyUntil: string;
}

/** 计算示值相对偏差，返回千分比数值（如 4.2 表示 4.2‰）；计量罐读数非正时返回 null */
export function deviationPerMille(indicated: number, measureRead: number): number | null {
  if (!(measureRead > 0) || !Number.isFinite(indicated) || !Number.isFinite(measureRead)) {
    return null;
  }
  return (Math.abs(indicated - measureRead) / measureRead) * 1000;
}

/** 检定期是否已过（到期日 < 今天） */
export function isVerifyExpired(verifyUntil: string, today: Date): boolean {
  if (!verifyUntil) return false;
  const due = new Date(`${verifyUntil}T00:00:00`);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return due.getTime() < startOfToday.getTime();
}

/**
 * 登记前校验单条录入：
 *  - 字段完整性
 *  - 同枪同班只能一条（与同批已登记项、以及本批录入草稿之间比较）
 * 返回错误信息；通过返回 null。
 */
export function validateDraftItem(
  draft: DraftNozzleItem,
  existing: NozzleCheckItem[],
  drafts: DraftNozzleItem[]
): string | null {
  if (!draft.gunNo.trim()) return "枪号必填";
  if (!draft.team) return "班组必填";
  if (!draft.fuel) return "油品必填";
  if (!(draft.indicated > 0)) return "示值须为大于 0 的数字";
  if (!(draft.measureRead > 0)) return "计量罐读数须为大于 0 的数字";
  if (!draft.verifyUntil) return "检定期必填";

  const dupExisting = existing.some(
    (item) => item.gunNo === draft.gunNo.trim() && item.team === draft.team
  );
  if (dupExisting) {
    return `同枪同班只能一条：${draft.gunNo} / ${draft.team} 已登记`;
  }
  const dupDraft = drafts.some(
    (other) =>
      other.key !== draft.key &&
      other.gunNo.trim() === draft.gunNo.trim() &&
      other.team === draft.team
  );
  if (dupDraft) {
    return `同枪同班只能一条：${draft.gunNo} / ${draft.team} 在录入列表中重复`;
  }
  return null;
}

interface BatchContext {
  batchId: string;
  batchNo: string;
}

/** 判定单条已登记枪项的阻断性冲突（检定期 / 偏差） */
export function evaluateItem(
  item: NozzleCheckItem,
  ctx: BatchContext,
  today: Date
): Conflict[] {
  const conflicts: Conflict[] = [];

  if (isVerifyExpired(item.verifyUntil, today)) {
    conflicts.push({
      code: "VERIFY_EXPIRED",
      rule: "检定期须在有效期内",
      level: "blocked",
      batchId: ctx.batchId,
      batchNo: ctx.batchNo,
      itemId: item.id,
      gunNo: item.gunNo,
      team: item.team,
      deviation: null,
      detail: `检定期至 ${item.verifyUntil}，已过期`
    });
  }

  const deviation = deviationPerMille(item.indicated, item.measureRead);
  if (deviation !== null && deviation > MAX_DEVIATION_PER_MILLE) {
    conflicts.push({
      code: "DEVIATION_OVER_3_PER_MILLE",
      rule: "示值相对偏差不得超过千分之三",
      level: "blocked",
      batchId: ctx.batchId,
      batchNo: ctx.batchNo,
      itemId: item.id,
      gunNo: item.gunNo,
      team: item.team,
      deviation: round2(deviation),
      detail: `示值 ${item.indicated}L，计量罐 ${item.measureRead}L，偏差 ${deviation.toFixed(2)}‰ > 3‰`
    });
  }

  return conflicts;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 找出批次内同枪同班的重复项（正常不会落库，主要用于刷新后数据自检） */
export function findDuplicateGunTeam(items: NozzleCheckItem[], ctx: BatchContext): Conflict[] {
  const seen = new Map<string, NozzleCheckItem>();
  const conflicts: Conflict[] = [];
  for (const item of items) {
    const key = `${item.gunNo}@@${item.team}`;
    if (seen.has(key)) {
      conflicts.push({
        code: "DUP_GUN_TEAM",
        rule: "同枪同班只能一条",
        level: "rejected",
        batchId: ctx.batchId,
        batchNo: ctx.batchNo,
        itemId: item.id,
        gunNo: item.gunNo,
        team: item.team,
        deviation: null,
        detail: `${item.gunNo} / ${item.team} 在本批出现多条核验项`
      });
    } else {
      seen.set(key, item);
    }
  }
  return conflicts;
}

/** 回执是否已完整回填：补差量、责任类型、说明三者齐全 */
export function isReceiptComplete(receipt: Receipt | undefined): boolean {
  if (!receipt) return false;
  return (
    receipt.diffVolume !== null &&
    Number.isFinite(receipt.diffVolume) &&
    receipt.responsibility !== "" &&
    receipt.explanation.trim().length > 0
  );
}

export interface BatchEvaluation {
  status: BatchStatus;
  conflicts: Conflict[]; // 阻断 + 自检冲突
  blockedItems: NozzleCheckItem[]; // 命中阻断规则的枪项
  totalItems: number;
  filledCount: number; // 已收回回执数
  canFreeze: boolean; // 是否满足核验完成条件：无阻断、无空枪项、回执全收回
  pendingReceiptItems: NozzleCheckItem[]; // 回执未收回的枪项
}

/** 对整个批次做判定（刷新后同样依据持久化数据重算，判定结果不单独存储） */
export function evaluateBatch(
  batch: { id: string; batchNo: string; status: BatchStatus },
  items: NozzleCheckItem[],
  receipts: Receipt[],
  today: Date
): BatchEvaluation {
  const ctx = { batchId: batch.id, batchNo: batch.batchNo };
  const receiptByItem = new Map(receipts.map((receipt) => [receipt.itemId, receipt]));

  const conflicts = [...findDuplicateGunTeam(items, ctx)];
  const blockedItemIds = new Set<string>();
  for (const item of items) {
    const itemConflicts = evaluateItem(item, ctx, today).filter((c) => c.level === "blocked");
    if (itemConflicts.length > 0) blockedItemIds.add(item.id);
    conflicts.push(...itemConflicts);
  }

  const blockedItems = items.filter((item) => blockedItemIds.has(item.id));
  const pendingReceiptItems = items.filter(
    (item) => !isReceiptComplete(receiptByItem.get(item.id))
  );
  const filledCount = items.length - pendingReceiptItems.length;
  const canFreeze =
    items.length > 0 && blockedItems.length === 0 && pendingReceiptItems.length === 0;

  return {
    status: batch.status,
    conflicts,
    blockedItems,
    totalItems: items.length,
    filledCount,
    canFreeze,
    pendingReceiptItems
  };
}

/** 校验一条回执的回填内容 */
export function validateReceipt(input: {
  diffVolume: number | null;
  responsibility: ResponsibilityType | "";
  explanation: string;
}): string | null {
  if (input.diffVolume === null || !Number.isFinite(input.diffVolume)) {
    return "补差量必填（正数溢余、负数短少、0 为平账）";
  }
  if (!input.responsibility) return "责任类型必填";
  if (!input.explanation.trim()) return "说明必填";
  return null;
}
