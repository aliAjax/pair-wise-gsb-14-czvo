// 数据层：首次进入时的演示数据。
// 包含一个已核验冻结批次（当前挂牌价的来源）和一个停在待复核的批次。

import type { VerificationState } from "./types";

/** 以 2026-09-23 为演示“今天”，保证检定期是否过期可直观看到 */
export const SEED_NOW = new Date("2026-09-23T09:00:00");

export function buildSeedState(): VerificationState {
  const issued1 = "2026-09-15T08:30:00";
  const frozen1 = "2026-09-15T11:20:00";

  const batches: VerificationState["batches"] = [
    {
      id: "seed-batch-1",
      batchNo: "TJ-20260915-001",
      status: "已核验",
      issuedAt: issued1,
      operator: "站长",
      effectiveDate: "2026-09-16",
      reason: "月度常规调价",
      prices: [
        { fuel: "92号汽油", oldPrice: 7.52, newPrice: 7.62 },
        { fuel: "95号汽油", oldPrice: 8.05, newPrice: 8.15 },
        { fuel: "柴油", oldPrice: 7.08, newPrice: 7.18 }
      ],
      correctedFromId: "",
      correctionReason: "",
      version: 1,
      frozenAt: frozen1
    },
    {
      id: "seed-batch-2",
      batchNo: "TJ-20260923-002",
      status: "待复核",
      issuedAt: "2026-09-23T08:40:00",
      operator: "值班经理",
      effectiveDate: "2026-09-24",
      reason: "接公司通知调价",
      prices: [
        { fuel: "92号汽油", oldPrice: 7.62, newPrice: 7.68 },
        { fuel: "95号汽油", oldPrice: 8.15, newPrice: 8.22 },
        { fuel: "98号汽油", oldPrice: 9.01, newPrice: 9.10 },
        { fuel: "柴油", oldPrice: 7.18, newPrice: 7.21 }
      ],
      correctedFromId: "",
      correctionReason: "",
      version: 1,
      frozenAt: ""
    }
  ];

  const items: VerificationState["items"] = [
    // 已核验批次的枪项
    { id: "seed-item-1", batchId: "seed-batch-1", gunNo: "1号枪", team: "甲班", fuel: "92号汽油", indicated: 100.2, measureRead: 100.1, verifyUntil: "2027-03-31", registeredAt: issued1 },
    { id: "seed-item-2", batchId: "seed-batch-1", gunNo: "3号枪", team: "乙班", fuel: "95号汽油", indicated: 99.9, measureRead: 100, verifyUntil: "2027-03-31", registeredAt: issued1 },
    { id: "seed-item-3", batchId: "seed-batch-1", gunNo: "5号枪", team: "丙班", fuel: "柴油", indicated: 200, measureRead: 200.2, verifyUntil: "2026-12-31", registeredAt: issued1 },
    // 待复核批次：4 条枪项，其中 3 号枪偏差超千分之三，5 号枪检定期已过
    { id: "seed-item-4", batchId: "seed-batch-2", gunNo: "1号枪", team: "甲班", fuel: "92号汽油", indicated: 100.1, measureRead: 100, verifyUntil: "2027-03-31", registeredAt: "2026-09-23T08:40:00" },
    { id: "seed-item-5", batchId: "seed-batch-2", gunNo: "3号枪", team: "乙班", fuel: "95号汽油", indicated: 100.5, measureRead: 100, verifyUntil: "2027-03-31", registeredAt: "2026-09-23T08:40:00" },
    { id: "seed-item-6", batchId: "seed-batch-2", gunNo: "5号枪", team: "丙班", fuel: "柴油", indicated: 200.1, measureRead: 200, verifyUntil: "2026-08-31", registeredAt: "2026-09-23T08:40:00" },
    { id: "seed-item-7", batchId: "seed-batch-2", gunNo: "7号枪", team: "甲班", fuel: "98号汽油", indicated: 80, measureRead: 80, verifyUntil: "2027-06-30", registeredAt: "2026-09-23T08:40:00" }
  ];

  const receipts: VerificationState["receipts"] = [
    { id: "seed-rec-1", itemId: "seed-item-1", batchId: "seed-batch-1", diffVolume: 0.1, responsibility: "正常发油", explanation: "发油误差在允许范围内", filledAt: "2026-09-15T10:05:00" },
    { id: "seed-rec-2", itemId: "seed-item-2", batchId: "seed-batch-1", diffVolume: -0.1, responsibility: "设备计量误差", explanation: "枪头略有偏差，已记录报修", filledAt: "2026-09-15T10:20:00" },
    { id: "seed-rec-3", itemId: "seed-item-3", batchId: "seed-batch-1", diffVolume: -0.2, responsibility: "正常发油", explanation: "正常计量偏差", filledAt: "2026-09-15T10:40:00" },
    // 待复核批次：1 条已回填，其余未收回
    { id: "seed-rec-4", itemId: "seed-item-4", batchId: "seed-batch-2", diffVolume: 0.1, responsibility: "正常发油", explanation: "示值与计量罐一致", filledAt: "2026-09-23T09:10:00" },
    { id: "seed-rec-5", itemId: "seed-item-5", batchId: "seed-batch-2", diffVolume: null, responsibility: "", explanation: "", filledAt: "" },
    { id: "seed-rec-6", itemId: "seed-item-6", batchId: "seed-batch-2", diffVolume: null, responsibility: "", explanation: "", filledAt: "" },
    { id: "seed-rec-7", itemId: "seed-item-7", batchId: "seed-batch-2", diffVolume: null, responsibility: "", explanation: "", filledAt: "" }
  ];

  return {
    activePrices: [
      { fuel: "92号汽油", price: 7.62, sourceBatchId: "seed-batch-1", since: frozen1 },
      { fuel: "95号汽油", price: 8.15, sourceBatchId: "seed-batch-1", since: frozen1 },
      { fuel: "98号汽油", price: 9.01, sourceBatchId: "", since: "2026-08-01T00:00:00" },
      { fuel: "柴油", price: 7.18, sourceBatchId: "seed-batch-1", since: frozen1 }
    ],
    batches,
    items,
    receipts,
    seq: 2
  };
}
