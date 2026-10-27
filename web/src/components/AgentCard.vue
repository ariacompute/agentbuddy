<script setup>
import { computed } from 'vue'
import { useCopy } from '../lib/use-copy.js'
import PersonaAvatar from './PersonaAvatar.vue'

const props = defineProps({
  agent: { type: Object, required: true },
})

const { t } = useCopy('enums')
const display = computed(() => props.agent.persona?.displayName || props.agent.displayName || props.agent.name)
const title = computed(() => props.agent.persona?.title || props.agent.persona?.tagline || '')
const health = computed(() => props.agent.health?.status || props.agent.health || 'unknown')
const healthText = computed(() => t('health')[health.value] || health.value)
const tags = computed(() => props.agent.tags || [])
</script>

<template>
  <div class="card card-hover agent-card">
    <div class="who">
      <PersonaAvatar :persona="agent.persona" :name="display" :size="40" />
      <div style="min-width:0">
        <div class="name truncate">{{ display }}</div>
        <div class="title truncate">{{ title }}</div>
      </div>
      <span class="chip" style="margin-inline-start:auto">
        <span class="state-dot" :data-state="health === 'healthy' ? 'completed' : health === 'degraded' ? 'working' : 'failed'" />
        {{ healthText }}
      </span>
    </div>
    <div class="tagline truncate" v-if="agent.description">{{ agent.description }}</div>
    <div class="tag-row" v-if="tags.length">
      <span v-for="tag in tags" :key="tag" class="chip">{{ tag }}</span>
    </div>
  </div>
</template>
