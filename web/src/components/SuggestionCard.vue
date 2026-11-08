<script setup>
// A suggestion with its supporting evidence (F15). Presentational only; the
// caller decides where the suggestion comes from (a thread message, a knowledge
// lookup, or the hub's proactive "ideas" stream).
defineProps({
  suggestion: { type: Object, required: true },
})
</script>

<template>
  <article class="card stack" style="border-inline-start:2px solid var(--border)">
    <div class="row" style="gap:8px;justify-content:space-between">
      <strong>{{ suggestion.title }}</strong>
      <span v-if="suggestion.confidence != null" class="chip chip-mono">
        {{ Math.round(suggestion.confidence * 100) }}%
      </span>
    </div>
    <p v-if="suggestion.body" class="muted">{{ suggestion.body }}</p>
    <ul v-if="suggestion.evidence?.length" class="stack" style="gap:4px;margin:0;padding-inline-start:16px">
      <li v-for="(e, i) in suggestion.evidence" :key="i" class="muted" style="font-size:12px">{{ e }}</li>
    </ul>
  </article>
</template>
