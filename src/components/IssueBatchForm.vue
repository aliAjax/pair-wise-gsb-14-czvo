<script setup lang="ts">
// 页面层：调价下发表单（兼作“更正另建版本”表单）。
// 登记失败（如同枪同班重复）时不离开表单、保留全部输入；
// 批次下发后统一进入“待复核”，由规则引擎判定是否阻断。
import { computed, reactive, ref } from "vue";
import { useVerificationStore } from "../verification/store";
import {
  FUEL_TYPES,
  TEAMS,
  type DraftNozzleItem,
  type FuelType,
  type TeamName
} from "../verification/types";

const props = defineProps<{
  mode: "issue" | "correct";
  sourceBatchId?: string;
}>();

const emit = defineEmits<{ (e: "done"): void; (e: "cancel"): void }>();

const store = useVerificationStore();

const sourceBatch = computed(() =>
  props.mode === "correct"
    ? store.state.batches.find((b) => b.id === props.sourceBatchId)
    : undefined
);

function defaultEffectiveDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function initialPrices(): Record<FuelType, string> {
  const result = {} as Record<FuelType, string>;
  for (const fuel of FUEL_TYPES) {
    const active = store.state.activePrices.find((a) => a.fuel === fuel);
    result[fuel] = active ? active.price.toFixed(2) : "";
  }
  return result;
}

const form = reactive({
  operator: "",
  effectiveDate: defaultEffectiveDate(),
  reason: "",
  correctionReason: "",
  prices: initialPrices()
});

let draftSeq = 0;
function makeDraft(partial?: Partial<DraftNozzleItem>): DraftNozzleItem {
  draftSeq += 1;
  return {
    key: `draft-${draftSeq}`,
    gunNo: partial?.gunNo ?? "",
    team: partial?.team ?? "",
    fuel: partial?.fuel ?? "",
    indicated: partial?.indicated ?? 0,
    measureRead: partial?.measureRead ?? 0,
    verifyUntil: partial?.verifyUntil ?? ""
  };
}

function initialDrafts(): DraftNozzleItem[] {
  if (sourceBatch.value) {
    const items = store.itemsByBatch.get(sourceBatch.value.id) ?? [];
    return items.map((item) =>
      makeDraft({
        gunNo: item.gunNo,
        team: item.team,
        fuel: item.fuel,
        indicated: item.indicated,
        measureRead: item.measureRead,
        verifyUntil: item.verifyUntil
      })
    );
  }
  return [makeDraft()];
}

const drafts = ref<DraftNozzleItem[]>(initialDrafts());
const formError = ref("");

function addRow() {
  drafts.value.push(makeDraft());
}

function removeRow(key: string) {
  drafts.value = drafts.value.filter((draft) => draft.key !== key);
}

function submit() {
  formError.value = "";
  if (!form.operator.trim()) return (formError.value = "操作员必填");
  if (!form.effectiveDate) return (formError.value = "拟生效日期必填");
  for (const fuel of FUEL_TYPES) {
    const value = Number(form.prices[fuel]);
    if (!(value > 0)) return (formError.value = `${fuel} 的新挂牌价须为大于 0 的数字`);
  }
  if (props.mode === "correct" && !form.correctionReason.trim()) {
    return (formError.value = "更正原因必填（更正须另建带原因的版本）");
  }

  for (const draft of drafts.value) {
    // 新批次在服务端视角尚无已登记项，existing 传空；同批重复由草稿互查
    const error = store.checkDraft(draft, drafts.value);
    if (error) return (formError.value = error);
  }

  const newPrices = Object.fromEntries(
    FUEL_TYPES.map((fuel) => [fuel, Number(form.prices[fuel])])
  ) as Partial<Record<FuelType, number>>;

  const items = drafts.value.map((draft) => ({
    gunNo: draft.gunNo,
    team: draft.team as TeamName,
    fuel: draft.fuel as FuelType,
    indicated: Number(draft.indicated),
    measureRead: Number(draft.measureRead),
    verifyUntil: draft.verifyUntil
  }));

  try {
    if (props.mode === "issue") {
      store.issueBatch({
        operator: form.operator,
        effectiveDate: form.effectiveDate,
        reason: form.reason,
        newPrices,
        items
      });
    } else if (sourceBatch.value) {
      store.correctBatch(sourceBatch.value.id, {
        operator: form.operator,
        effectiveDate: form.effectiveDate,
        reason: form.reason,
        correctionReason: form.correctionReason,
        newPrices,
        items
      });
    }
    emit("done");
  } catch (error) {
    // 保留全部输入，仅提示
    formError.value = (error as Error).message;
  }
}
</script>

<template>
  <section class="panel issue-form">
    <header class="detail-head">
      <h2>{{ mode === "issue" ? "下发调价批次" : `更正批次 ${sourceBatch?.batchNo}（另建版本）` }}</h2>
      <button type="button" class="secondary" @click="emit('cancel')">取消</button>
    </header>

    <div v-if="mode === 'correct'" class="correction-banner">
      更正不会改动已冻结批次：系统将新建版本号 +1 的批次并重新走待复核流程，期间原价继续生效。
    </div>

    <form class="issue-grid" @submit.prevent="submit">
      <label>
        操作员
        <input v-model="form.operator" type="text" placeholder="如：值班经理" required />
      </label>
      <label>
        拟生效日期
        <input v-model="form.effectiveDate" type="date" required />
      </label>
      <label class="wide">
        调价说明
        <input v-model="form.reason" type="text" placeholder="如：接公司通知调价" />
      </label>
      <label v-if="mode === 'correct'" class="wide">
        更正原因 *
        <input v-model="form.correctionReason" type="text" placeholder="说明为何对已冻结批次进行更正" />
      </label>

      <fieldset class="prices wide">
        <legend>新挂牌价（元/升，未启用前原价继续生效）</legend>
        <div class="price-inputs">
          <label v-for="fuel in FUEL_TYPES" :key="fuel">
            {{ fuel }}
            <input v-model="form.prices[fuel]" type="number" step="0.01" min="0.01" required />
          </label>
        </div>
      </fieldset>

      <fieldset class="nozzles wide">
        <legend>按油枪登记核验项（同枪同班只能一条）</legend>
        <div class="nozzle-rows">
          <div v-for="(draft, index) in drafts" :key="draft.key" class="nozzle-row">
            <span class="row-index">{{ index + 1 }}</span>
            <label>
              枪号
              <input v-model="draft.gunNo" type="text" placeholder="如：1号枪" required />
            </label>
            <label>
              班组
              <select v-model="draft.team" required>
                <option value="">请选择</option>
                <option v-for="team in TEAMS" :key="team" :value="team">{{ team }}</option>
              </select>
            </label>
            <label>
              油品
              <select v-model="draft.fuel" required>
                <option value="">请选择</option>
                <option v-for="fuel in FUEL_TYPES" :key="fuel" :value="fuel">{{ fuel }}</option>
              </select>
            </label>
            <label>
              示值（L）
              <input v-model.number="draft.indicated" type="number" step="0.01" min="0.01" required />
            </label>
            <label>
              计量罐读数（L）
              <input v-model.number="draft.measureRead" type="number" step="0.01" min="0.01" required />
            </label>
            <label>
              检定期
              <input v-model="draft.verifyUntil" type="date" required />
            </label>
            <button type="button" class="danger icon-btn" @click="removeRow(draft.key)">删</button>
          </div>
        </div>
        <button type="button" class="secondary add-btn" @click="addRow">+ 添加枪项</button>
      </fieldset>

      <p v-if="formError" class="row-error wide">{{ formError }}</p>
      <div class="wide form-actions">
        <button type="submit">{{ mode === "issue" ? "下发批次（进入待复核）" : "创建更正版本" }}</button>
      </div>
    </form>
  </section>
</template>
