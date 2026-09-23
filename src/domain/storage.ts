// 存储层：localStorage 的读写、版本兼容与演示种子。
// 不做任何业务判定；深冻结交给调用方在写入前完成。

import type {
  AdjustmentBatch,
  CurrentPrice,
  NozzleItem,
  PersistShape,
  PriceMap
} from "./types";
import { emptyReceipt, FUELS } from "./types";

const STORAGE_KEY = "dfwlfront-9-verification-v1";

function localDate(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function localDateTime(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function seedPrices(): PriceMap {
  const base: Record<string, number> = { "92": 7.62, "95": 8.13, "98": 9.06, "0": 7.18 };
  const map = {} as PriceMap;
  for (const fuel of FUELS) {
    const current: CurrentPrice = {
      fuel: fuel.code,
      price: base[fuel.code],
      batchId: null,
      updatedAt: null
    };
    map[fuel.code] = current;
  }
  return map;
}

function item(
  partial: Omit<NozzleItem, "id" | "receipt"> & Partial<Pick<NozzleItem, "receipt">>
): NozzleItem {
  return {
    id: crypto.randomUUID(),
    receipt: emptyReceipt(),
    ...partial
  };
}

function seedBatches(): AdjustmentBatch[] {
  // 批次一：上周完成复核并冻结，92/95 已按新价启用，原价已被这批替换。
  const frozen: AdjustmentBatch = {
    id: crypto.randomUUID(),
    batchNo: "TJ-20260916-01",
    version: 1,
    sourceBatchId: null,
    correctionReason: "",
    revisedByBatchId: null,
    issuedAt: localDateTime(7),
    issuedBy: "站长",
    effectiveDate: localDate(6),
    changes: [
      { fuel: "92", oldPrice: 7.55, newPrice: 7.62 },
      { fuel: "95", oldPrice: 8.05, newPrice: 8.13 }
    ],
    items: [
      item({
        nozzleNo: "1号枪",
        shift: "早班",
        indication: 100.02,
        measureTank: 100,
        verifiedUntil: localDate(40),
        receipt: {
          diffQty: 0.02,
          responsibility: "计量误差",
          note: "示值与计量罐偏差在允许范围内，按计量误差登记。",
          filledAt: localDateTime(6)
        }
      }),
      item({
        nozzleNo: "2号枪",
        shift: "早班",
        indication: 99.96,
        measureTank: 100,
        verifiedUntil: localDate(120),
        receipt: {
          diffQty: -0.04,
          responsibility: "计量误差",
          note: "溢余 0.04 升，已在班结时冲减。",
          filledAt: localDateTime(6)
        }
      })
    ],
    status: "已冻结",
    frozenAt: localDateTime(6)
  };

  // 批次二：本批调价下发后生成核验项，停在待复核：
  // 3号枪检定期已过、4号枪偏差超 3‰、5号枪与4号枪同班重复、6号枪回执未回填。
  const pending: AdjustmentBatch = {
    id: crypto.randomUUID(),
    batchNo: "TJ-20260923-01",
    version: 1,
    sourceBatchId: null,
    correctionReason: "",
    revisedByBatchId: null,
    issuedAt: localDateTime(0),
    issuedBy: "值班经理",
    effectiveDate: localDate(1),
    changes: [
      { fuel: "98", oldPrice: 9.06, newPrice: 9.18 },
      { fuel: "0", oldPrice: 7.18, newPrice: 7.25 }
    ],
    items: [
      item({
        nozzleNo: "3号枪",
        shift: "早班",
        indication: 200.01,
        measureTank: 200,
        verifiedUntil: localDate(3),
        receipt: {
          diffQty: 0.01,
          responsibility: "计量误差",
          note: "读数正常，但检定证书刚到期，待送检后更正本批。",
          filledAt: localDateTime(0)
        }
      }),
      item({
        nozzleNo: "4号枪",
        shift: "中班",
        indication: 200.9,
        measureTank: 200,
        verifiedUntil: localDate(80),
        receipt: {
          diffQty: 0.9,
          responsibility: "加油站承担",
          note: "偏差超限，已停用该枪并报修，短量由本站承担。",
          filledAt: localDateTime(0)
        }
      }),
      item({
        nozzleNo: "5号枪",
        shift: "中班",
        indication: 150.03,
        measureTank: 150,
        verifiedUntil: localDate(60),
        receipt: {
          diffQty: 0.03,
          responsibility: "承运方承担",
          note: "与4号枪同中班，需改挂班组重新核验。",
          filledAt: localDateTime(0)
        }
      }),
      item({
        nozzleNo: "6号枪",
        shift: "晚班",
        indication: 180.02,
        measureTank: 180,
        verifiedUntil: localDate(55)
      })
    ],
    status: "待复核",
    frozenAt: null
  };

  return [pending, frozen];
}

export function loadState(): PersistShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { schemaVersion: 1, prices: seedPrices(), batches: seedBatches() };
  }
  try {
    const parsed = JSON.parse(raw) as PersistShape;
    if (parsed.schemaVersion !== 1 || !parsed.prices || !Array.isArray(parsed.batches)) {
      return { schemaVersion: 1, prices: seedPrices(), batches: seedBatches() };
    }
    return parsed;
  } catch {
    return { schemaVersion: 1, prices: seedPrices(), batches: seedBatches() };
  }
}

export function saveState(state: PersistShape): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export type { AdjustmentBatch };
