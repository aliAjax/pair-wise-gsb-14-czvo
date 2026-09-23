<script setup lang="ts">
// 单批复核卡：待复核时可逐枪修改登记、回填短溢回执并尝试冻结；
// 已冻结/已更正时只读，并支持“更正另建带原因版本”。
import { computed, ref } from "vue";
import { useVerificationStore } from "../stores/verification";
import { formatPermille, relativeDeviation, type NozzleConflict } from "../domain/rules";
import {
  fuelName,
  RESPONSIBILITY_TYPES,
  SHIFTS,
  type AdjustmentBatch,
  type NozzleItem,
  type Receipt,
  type ResponsibilityType,
  type Shift
} from "../domain/types";

const props = defineProps<{ batch: AdjustmentBatch }>();
const store = useVerificationStore();

const editable = computed(() => props.batch.status === "待复核");
const allConflicts = computed(() => store.conflictsOf(props.batch.id));
// 冻结后规则判定即固化留档，不再因时间推移翻出冲突
const conflicts = computed(() =>
  editable.value ? allConflicts.value : new Map<string, NozzleConflict[]>()
);
const check = computed(() => store.freezeCheck(props.batch.id));
const receiptsDone = computed(
  () => props.batch.items.length - check.value.pendingReceipts
);
const feedback = ref<{ ok: boolean; message: string } | null>(null);

const correcting = ref(false);
const correctionReason = ref("");

function num(event: Event): number | null {
  const value = (event.target as HTMLInputElement).value;
  return value.trim() === "" ? null : Number(value);
}

function patchItem(item: NozzleItem, patch: Partial<NozzleItem>) {
  store.updateItem(props.batch.id, item.id, patch);
}

function patchReceipt(item: NozzleItem, patch: Partial<Receipt>) {
  store.saveReceipt(props.batch.id, item.id, patch);
}

function deviationOf(item: NozzleItem) {
  return relativeDeviation(item.indication, item.measureTank);
}

function tryFreeze() {
  feedback.value = null;
  const result = store.freeze(props.batch.id);
  feedback.value = { ok: result.ok, message: result.message };
}

function submitCorrection() {
  const result = store.correct(props.batch.id, correctionReason.value);
  feedback.value = { ok: result.ok, message: result.message };
  if (result.ok) {
    correcting.value = false;
    correctionReason.value = "";
  }
}
</script>

<template>
  <article class="batch-card" :class="editable ? 'is-pending' : 'is-frozen'">
    <header class="batch-head">
      <div class="batch-title">
        <h3>
          {{ batch.batchNo }}
          <span v-if="batch.version > 1" class="version">v{{ batch.version }} 更正版</span>
        </h3>
        <p class="batch-meta">
          下发人 {{ batch.issuedBy }} · 下发 {{ batch.issuedAt.slice(0, 16).replace("T", " ") }}
          · 拟生效 {{ batch.effectiveDate }}
        </p>
        <p v-if="batch.sourceBatchId" class="batch-meta">
          更正自上游版本；原因：{{ batch.correctionReason }}
        </p>
        <p v-if="batch.status === '已更正' && batch.revisedByBatchId" class="batch-meta">
          本版本已被后续更正版本替代，内容冻结留档。
        </p>
      </div>
      <div class="batch-side">
        <span class="batch-status" :class="editable ? 'st-pending' : 'st-frozen'">{{ batch.status }}</span>
        <span v-if="batch.frozenAt" class="frozen-at">冻结 {{ batch.frozenAt.slice(0, 16).replace("T", " ") }}</span>
      </div>
    </header>

    <div class="changes">
      <span v-for="change in batch.changes" :key="change.fuel" class="change-chip">
        {{ fuelName(change.fuel) }}：
        <del>¥{{ change.oldPrice.toFixed(2) }}</del>
        <strong :class="{ 'not-active': editable }">¥{{ change.newPrice.toFixed(2) }}</strong>
        <em v-if="!editable">已启用</em>
        <em v-else class="wait">待启用，原价生效中</em>
      </span>
    </div>

    <div class="table-wrap">
      <table class="gun-table">
        <thead>
          <tr>
            <th>枪号</th>
            <th>班组</th>
            <th>示值(升)</th>
            <th>计量罐(升)</th>
            <th>检定期至</th>
            <th>相对偏差</th>
            <th class="receipt-col">补差量(升)</th>
            <th class="receipt-col">责任类型</th>
            <th class="receipt-col wide">说明</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in batch.items" :key="item.id" :class="{ 'row-conflict': (conflicts.get(item.id)?.length ?? 0) > 0 }">
            <td>
              <input v-if="editable" :value="item.nozzleNo" @input="patchItem(item, { nozzleNo: ($event.target as HTMLInputElement).value })" />
              <span v-else>{{ item.nozzleNo }}</span>
            </td>
            <td>
              <select v-if="editable" :value="item.shift" @change="patchItem(item, { shift: ($event.target as HTMLSelectElement).value as Shift })">
                <option value="">请选择</option>
                <option v-for="shift in SHIFTS" :key="shift" :value="shift">{{ shift }}</option>
              </select>
              <span v-else>{{ item.shift }}</span>
            </td>
            <td>
              <input v-if="editable" type="number" step="0.01" :value="item.indication ?? ''" @input="patchItem(item, { indication: num($event) })" />
              <span v-else>{{ item.indication }}</span>
            </td>
            <td>
              <input v-if="editable" type="number" step="0.01" :value="item.measureTank ?? ''" @input="patchItem(item, { measureTank: num($event) })" />
              <span v-else>{{ item.measureTank }}</span>
            </td>
            <td>
              <input v-if="editable" type="date" :value="item.verifiedUntil" @input="patchItem(item, { verifiedUntil: ($event.target as HTMLInputElement).value })" />
              <span v-else>{{ item.verifiedUntil }}</span>
            </td>
            <td>
              <strong :class="{ over: deviationOf(item) != null && Math.abs(deviationOf(item)!) > 0.003 }">
                {{ formatPermille(deviationOf(item)) }}
              </strong>
              <span v-if="item.receipt.filledAt" class="receipt-flag">回执已收</span>
              <span v-else-if="editable" class="receipt-flag missing">回执未收</span>
            </td>
            <td class="receipt-col">
              <input
                :disabled="!editable"
                type="number"
                step="0.01"
                :value="item.receipt.diffQty ?? ''"
                placeholder="正短/负溢"
                @input="patchReceipt(item, { diffQty: num($event) })"
              />
            </td>
            <td class="receipt-col">
              <select
                :disabled="!editable"
                :value="item.receipt.responsibility"
                @change="patchReceipt(item, { responsibility: ($event.target as HTMLSelectElement).value as ResponsibilityType })"
              >
                <option value="">请选择</option>
                <option v-for="type in RESPONSIBILITY_TYPES" :key="type" :value="type">{{ type }}</option>
              </select>
            </td>
            <td class="receipt-col wide">
              <textarea
                :disabled="!editable"
                :value="item.receipt.note"
                rows="2"
                placeholder="短溢原因、处理经过"
                @input="patchReceipt(item, { note: ($event.target as HTMLTextAreaElement).value })"
              />
            </td>
            <td>
              <button v-if="editable" type="button" class="danger small" @click="store.removeItem(batch.id, item.id)">移除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul v-if="[...conflicts.values()].some((list) => list.length > 0)" class="conflict-list">
      <template v-for="item in batch.items" :key="item.id">
        <li v-for="conflict in conflicts.get(item.id)" :key="conflict.rule">
          <em>{{ conflict.rule }}</em>
          <span class="c-batch">{{ batch.batchNo }}</span>
          <span class="c-gun">{{ item.nozzleNo || "（未填枪号）" }} / {{ item.shift || "未排班" }}</span>
          <span class="c-dev">偏差 {{ formatPermille(deviationOf(item)) }}</span>
          <span class="c-msg">{{ conflict.message }}</span>
        </li>
      </template>
    </ul>

    <footer v-if="editable" class="batch-foot">
      <div class="freeze-info">
        <p>
          回执收回：<strong>{{ receiptsDone }}/{{ batch.items.length }}</strong>
          · 规则冲突：<strong :class="{ 'num-bad': check.conflictCount > 0 }">{{ check.conflictCount }}</strong>
        </p>
        <p class="hint">未收回全部回执或存在冲突时，整批停在待复核，新挂牌价不启用，原价继续生效。</p>
      </div>
      <div class="foot-actions">
        <button type="button" class="secondary" @click="store.addItem(batch.id)">补登油枪</button>
        <button type="button" :disabled="!check.ok" @click="tryFreeze">核验完成 · 冻结批次</button>
      </div>
    </footer>

    <footer v-else class="batch-foot frozen-foot">
      <p class="hint">批次、枪项与回执已全部冻结；如需调整，请说明原因并另建更正版本。</p>
      <button v-if="!correcting && batch.status === '已冻结'" type="button" class="secondary" @click="correcting = true">更正 · 另建版本</button>
    </footer>

    <div v-if="correcting" class="correct-box">
      <label>
        更正原因（新版本将复制油品调价与枪号班组，清空示值、计量罐读数、检定期与回执，重新逐枪核验）
        <textarea v-model="correctionReason" rows="2" placeholder="如：3号枪重新检定合格，按新证书复核" />
      </label>
      <div class="foot-actions">
        <button type="button" class="secondary" @click="correcting = false">取消</button>
        <button type="button" :disabled="correctionReason.trim() === ''" @click="submitCorrection">生成 v{{ batch.version + 1 }} 更正版本</button>
      </div>
    </div>

    <p v-if="feedback" class="feedback" :class="feedback.ok ? 'ok' : 'err'">{{ feedback.message }}</p>
  </article>
</template>
