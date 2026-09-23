<script setup lang="ts">
// 调价下发台：填写新挂牌价并按油枪登记核验项；
// 冲突预检即时展示（同枪同班、检定期、3‰偏差），输入始终保留，提交后整批停在待复核。
import { computed, reactive, ref } from "vue";
import { useVerificationStore } from "../stores/verification";
import { evaluateDrafts, formatPermille, relativeDeviation } from "../domain/rules";
import {
  emptyDraft,
  FUELS,
  fuelName,
  SHIFTS,
  type FuelCode,
  type NozzleDraft
} from "../domain/types";

const store = useVerificationStore();

const issuedBy = ref("");
const effectiveDate = ref("");
const lines = reactive<Record<FuelCode, { checked: boolean; newPrice: number | null }>>({
  "92": { checked: false, newPrice: null },
  "95": { checked: false, newPrice: null },
  "98": { checked: false, newPrice: null },
  "0": { checked: false, newPrice: null }
});
const drafts = ref<NozzleDraft[]>([emptyDraft(), emptyDraft(), emptyDraft()]);
const feedback = ref<{ ok: boolean; message: string } | null>(null);
const attempted = ref(false);

function defaultEffectiveDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
effectiveDate.value = defaultEffectiveDate();

function asNumber(event: Event): number | null {
  const value = (event.target as HTMLInputElement).value;
  return value.trim() === "" ? null : Number(value);
}

function addDraft() {
  drafts.value.push(emptyDraft());
}

function removeDraft(index: number) {
  drafts.value.splice(index, 1);
}

const selectedLines = computed(() =>
  FUELS.filter((fuel) => lines[fuel.code].checked).map((fuel) => ({
    fuel: fuel.code,
    newPrice: lines[fuel.code].newPrice
  }))
);

const draftConflicts = computed(() => evaluateDrafts(drafts.value, store.today));
const precheckConflictCount = computed(() =>
  [...draftConflicts.value.values()].reduce((sum, list) => sum + list.length, 0)
);

const usedDrafts = computed(() =>
  drafts.value.filter(
    (d) =>
      d.nozzleNo.trim() !== "" ||
      d.shift !== "" ||
      d.indication != null ||
      d.measureTank != null ||
      d.verifiedUntil !== ""
  )
);

function submit() {
  attempted.value = true;
  feedback.value = null;
  const result = store.dispatch({
    issuedBy: issuedBy.value,
    effectiveDate: effectiveDate.value,
    lines: selectedLines.value.map((line) => ({
      fuel: line.fuel,
      newPrice: line.newPrice ?? NaN
    })),
    drafts: drafts.value
  });
  feedback.value = { ok: result.ok, message: result.message };
  if (result.ok) {
    issuedBy.value = "";
    effectiveDate.value = defaultEffectiveDate();
    for (const fuel of FUELS) lines[fuel.code] = { checked: false, newPrice: null };
    drafts.value = [emptyDraft(), emptyDraft(), emptyDraft()];
    attempted.value = false;
  }
}
</script>

<template>
  <section class="panel dispatch">
    <h2>调价下发 · 生成油枪核验项</h2>
    <p class="hint">下发后按油枪逐枪生成核验项，整批进入待复核；即使检定期过期或偏差超过 3‰，输入也原样保留，由复核台处理。</p>

    <form class="dispatch-body" @submit.prevent="submit">
      <div class="dispatch-col">
        <h3>调价单</h3>
        <label>
          下发人
          <input v-model="issuedBy" placeholder="如：值班经理" />
        </label>
        <label>
          拟生效日期
          <input v-model="effectiveDate" type="date" :min="store.today" />
        </label>

        <div class="line-list">
          <p class="sub-label">挂牌价（原价 → 新价，元/升）</p>
          <label v-for="fuel in FUELS" :key="fuel.code" class="line-row">
            <input v-model="lines[fuel.code].checked" type="checkbox" />
            <span class="line-fuel">{{ fuelName(fuel.code) }}</span>
            <span class="line-old">¥{{ store.currentPriceOf(fuel.code).toFixed(2) }}</span>
            <span class="arrow">→</span>
            <input
              class="line-new"
              type="number"
              step="0.01"
              min="0"
              :disabled="!lines[fuel.code].checked"
              :value="lines[fuel.code].newPrice ?? ''"
              @input="lines[fuel.code].newPrice = asNumber($event)"
            />
          </label>
        </div>

        <div class="precheck" :class="{ bad: precheckConflictCount > 0 }">
          <template v-if="precheckConflictCount > 0">
            预检发现 {{ precheckConflictCount }} 条规则提示，仍可下发，整批将停在待复核。
          </template>
          <template v-else>已填项目暂未发现规则冲突。</template>
        </div>
      </div>

      <div class="dispatch-col">
        <div class="sub-head">
          <h3>油枪登记</h3>
          <button type="button" class="secondary small" @click="addDraft">加一行</button>
        </div>
        <div class="draft-list">
          <div v-for="(draft, index) in drafts" :key="index" class="draft-row">
            <div class="draft-grid">
              <label>
                枪号
                <input v-model="draft.nozzleNo" placeholder="如：3号枪" />
              </label>
              <label>
                班组
                <select v-model="draft.shift">
                  <option value="">请选择</option>
                  <option v-for="shift in SHIFTS" :key="shift" :value="shift">{{ shift }}</option>
                </select>
              </label>
              <label>
                示值(升)
                <input
                  type="number"
                  step="0.01"
                  :value="draft.indication ?? ''"
                  @input="draft.indication = asNumber($event)"
                />
              </label>
              <label>
                计量罐读数(升)
                <input
                  type="number"
                  step="0.01"
                  :value="draft.measureTank ?? ''"
                  @input="draft.measureTank = asNumber($event)"
                />
              </label>
              <label>
                检定有效期至
                <input v-model="draft.verifiedUntil" type="date" />
              </label>
              <button type="button" class="danger small draft-del" @click="removeDraft(index)">删</button>
            </div>
            <p class="deviation">
              相对偏差：
              <strong :class="{ over: (relativeDeviation(draft.indication, draft.measureTank) ?? 0) !== 0 && Math.abs(relativeDeviation(draft.indication, draft.measureTank) ?? 0) > 0.003 }">
                {{ formatPermille(relativeDeviation(draft.indication, draft.measureTank)) }}
              </strong>
              <span class="limit">（红线 ±3.00‰）</span>
            </p>
            <ul v-if="(draftConflicts.get(index)?.length ?? 0) > 0" class="conflict-mini">
              <li v-for="conflict in draftConflicts.get(index)" :key="conflict.rule">
                <em>{{ conflict.rule }}</em>：{{ conflict.message }}
              </li>
            </ul>
          </div>
          <p v-if="usedDrafts.length === 0" class="empty-line">尚未填写任何油枪核验项</p>
        </div>
      </div>

      <div class="dispatch-foot">
        <button type="submit">下发批次（进入待复核）</button>
        <p v-if="feedback" class="feedback" :class="feedback.ok ? 'ok' : 'err'">{{ feedback.message }}</p>
      </div>
    </form>
  </section>
</template>
