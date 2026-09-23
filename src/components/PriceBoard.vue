<script setup lang="ts">
// 挂牌价看板：当前生效价来自最近一次冻结；待复核批次的新价只提示不启用。
import { computed } from "vue";
import { useVerificationStore } from "../stores/verification";
import { FUELS, fuelName } from "../domain/types";

const store = useVerificationStore();

const cards = computed(() =>
  FUELS.map((fuel) => {
    const current = store.prices[fuel.code];
    const waiting = store.pendingBatches
      .flatMap((b) => b.changes.map((change) => ({ batch: b, change })))
      .find((entry) => entry.change.fuel === fuel.code);
    return { fuel, current, waiting };
  })
);

function priceText(value: number): string {
  return value.toFixed(2);
}
</script>

<template>
  <section class="panel price-board">
    <div class="board-head">
      <div>
        <h2>当前挂牌价（原价继续生效）</h2>
        <p class="hint">只有批次复核完成并冻结后，新挂牌价才会替换下表价格。</p>
      </div>
      <span class="today">今日 {{ store.today }}</span>
    </div>
    <div class="price-grid">
      <article v-for="card in cards" :key="card.fuel.code" class="price-card">
        <p class="fuel-name">{{ fuelName(card.fuel.code) }}</p>
        <p class="price-now">
          <strong>¥{{ priceText(card.current.price) }}</strong>
          <span>/升</span>
        </p>
        <p v-if="card.waiting" class="price-wait">
          待启用 ¥{{ priceText(card.waiting.change.newPrice) }}
          <em>{{ card.waiting.batch.batchNo }}<template v-if="card.waiting.batch.version > 1"> · v{{ card.waiting.batch.version }}</template></em>
        </p>
        <p v-else class="price-idle">近期无待启用调价</p>
      </article>
    </div>
  </section>
</template>
