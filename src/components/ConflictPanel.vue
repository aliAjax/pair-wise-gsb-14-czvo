<script setup lang="ts">
// 冲突清单：跨批次摊平，列出批次、枪号、偏差和命中的规则。
import { computed } from "vue";
import { useVerificationStore } from "../stores/verification";
import { formatPermille } from "../domain/rules";

const store = useVerificationStore();
const rows = computed(() => store.flatConflicts);
</script>

<template>
  <section class="panel conflict-panel">
    <div class="board-head">
      <div>
        <h2>规则冲突清单</h2>
        <p class="hint">规则：同枪同班只能一条；检定期不得早于今日；示值相对偏差不得超过 ±3.00‰。</p>
      </div>
      <span class="today" :class="{ 'has-bad': rows.length > 0 }">{{ rows.length }} 条待处理</span>
    </div>

    <div v-if="rows.length === 0" class="empty-block">所有待复核批次暂未命中规则冲突。</div>
    <div v-else class="table-wrap">
      <table class="conflict-table">
        <thead>
          <tr>
            <th>批次</th>
            <th>版本</th>
            <th>枪号</th>
            <th>班组</th>
            <th>相对偏差</th>
            <th>命中规则</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="`${row.itemId}-${row.rule}-${index}`">
            <td>{{ row.batchNo }}</td>
            <td>v{{ row.version }}</td>
            <td>{{ row.nozzleNo }}</td>
            <td>{{ row.shift || "—" }}</td>
            <td>
              <strong :class="{ over: row.deviation != null && Math.abs(row.deviation) > 0.003 }">
                {{ formatPermille(row.deviation) }}
              </strong>
            </td>
            <td><span class="rule-tag">{{ row.rule }}</span></td>
            <td class="c-msg">{{ row.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
