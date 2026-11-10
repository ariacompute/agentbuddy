<script setup>
import { computed, onMounted, ref } from 'vue'
import { Download, FileText, RefreshCw, Trash2, UploadCloud } from 'lucide-vue-next'
import { useCopy } from '../lib/use-copy.js'
import { deleteFile, fileContentUrl, listFiles, uploadFile } from '../lib/api.js'
import { errorMessage } from '../lib/errors.js'

// The files screen: upload, list, download, delete. The bytes never pass through
// this component — a download is a plain link to `/api/files/{id}/content`, which
// keeps a 32 MiB document out of JS memory and lets the browser resume it with a
// Range request. Only the upload needs JS, because only it needs progress.
const { t } = useCopy('files')

const files = ref([])
const maxBytes = ref(0)
const loading = ref(true)
const error = ref('')
// A server with AGENTHUB_FILES_STORE=off answers 503 files_disabled. That is a
// configuration, not a failure, so the screen says so instead of "no files".
const featureOff = ref(false)

const uploading = ref(false)
const percent = ref(0)
const uploadError = ref('')
const dragging = ref(false)

const pendingDelete = ref('')
const deleting = ref('')
const fileInput = ref(null)

function formatSize(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

const limitLabel = computed(() => formatSize(maxBytes.value))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listFiles()
    files.value = Array.isArray(data?.files) ? data.files : []
    maxBytes.value = Number(data?.maxBytes) || 0
    featureOff.value = false
  } catch (e) {
    if (e.code === 'files_disabled') {
      featureOff.value = true
      files.value = []
    } else {
      error.value = errorMessage(e.code) || e.message
    }
  } finally {
    loading.value = false
  }
}

function choose() {
  if (uploading.value) return
  fileInput.value?.click()
}

function onPicked(event) {
  const picked = event.target?.files?.[0]
  // Reset first: picking the same file twice must still fire a change event.
  if (event.target) event.target.value = ''
  if (picked) send(picked)
}

function onDrop(event) {
  dragging.value = false
  const dropped = event.dataTransfer?.files?.[0]
  if (dropped) send(dropped)
}

async function send(file) {
  uploadError.value = ''
  if (maxBytes.value > 0 && file.size > maxBytes.value) {
    // Caught here as well as on the server: uploading 64 MiB to be told no wastes
    // the whole upload.
    uploadError.value = errorMessage('file_too_large')
    return
  }
  uploading.value = true
  percent.value = 0
  try {
    await uploadFile(file, (value) => {
      percent.value = value
    })
    percent.value = 100
    await load()
  } catch (e) {
    uploadError.value = errorMessage(e.code) || e.message
  } finally {
    uploading.value = false
  }
}

async function confirmDelete(id) {
  deleting.value = id
  error.value = ''
  try {
    await deleteFile(id)
    pendingDelete.value = ''
    await load()
  } catch (e) {
    // The delete answers 404 for an id the server cannot see, which is a file
    // already gone (deleted on another machine, or a retry after a dropped
    // answer). The intent is satisfied, so the list is reloaded instead of
    // raising a refusal in front of a row that no longer exists.
    if (e.code === 'file_not_found') {
      pendingDelete.value = ''
      await load()
      return
    }
    // A refusal stays in place: the row must not disappear as if it had worked.
    error.value = errorMessage(e.code) || e.message
  } finally {
    deleting.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>{{ t('filesTitle') }}</h1>
        <p class="sub">{{ t('filesSub') }}</p>
      </div>
      <div class="row" style="gap: 8px">
        <button class="btn btn-ghost btn-sm" :disabled="loading" @click="load">
          <RefreshCw :size="14" />
          {{ t('filesRetry') }}
        </button>
        <button v-if="!featureOff" class="btn btn-primary" :disabled="uploading" @click="choose">
          <UploadCloud :size="16" />
          {{ t('filesUpload') }}
        </button>
      </div>
    </div>

    <input ref="fileInput" class="files-input" type="file" @change="onPicked" />

    <section v-if="featureOff" class="card stack">
      <h2 class="card-title">{{ t('filesTitle') }}</h2>
      <p class="muted">{{ t('filesOff') }}</p>
      <!-- A machine setting, not prose: it stays the same in every language and
           tells the operator which switch to turn on before retrying. -->
      <p class="muted mono">AGENTHUB_FILES_STORE=local | s3</p>
    </section>

    <template v-else>
      <div
        class="files-drop"
        :class="{ 'is-over': dragging, 'is-busy': uploading }"
        role="button"
        tabindex="0"
        @click="choose"
        @keyup.enter="choose"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <UploadCloud :size="26" />
        <p>{{ t('filesDrop') }}</p>
        <p v-if="maxBytes > 0" class="muted mono">{{ t('filesLimit').replace('{size}', limitLabel) }}</p>
        <div v-if="uploading" class="files-progress" :aria-label="t('filesUploading').replace('{percent}', String(percent))">
          <span :style="{ width: `${percent}%` }"></span>
        </div>
        <p v-if="uploading" class="muted mono">{{ t('filesUploading').replace('{percent}', String(percent)) }}</p>
      </div>

      <div v-if="uploadError" class="banner banner-error">
        <span>{{ uploadError }}</span>
        <button class="btn btn-ghost btn-sm" @click="choose">{{ t('filesRetry') }}</button>
      </div>

      <div v-if="error" class="banner banner-error">
        <span>{{ error }}</span>
        <button class="btn btn-ghost btn-sm" @click="load">{{ t('filesRetry') }}</button>
      </div>

      <div v-if="loading" class="empty"><p class="muted">…</p></div>

      <div v-else-if="files.length === 0" class="empty">
        <FileText :size="30" />
        <p>{{ t('filesEmpty') }}</p>
        <button class="btn btn-sm" @click="choose">{{ t('filesUpload') }}</button>
      </div>

      <section v-else class="card" style="padding: 4px 10px">
        <table class="table files-table">
          <thead>
            <tr>
              <th>{{ t('filesColName') }}</th>
              <th>{{ t('filesColSize') }}</th>
              <th>{{ t('filesColUploaded') }}</th>
              <th style="text-align: end">{{ t('filesColActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="file in files" :key="file.id">
              <tr>
                <td data-col="name">
                  <div class="files-name">
                    <span>{{ file.name }}</span>
                    <span class="muted mono" style="font-size: 11px">{{ file.mime || '—' }}</span>
                  </div>
                </td>
                <td data-col="size" class="mono">{{ formatSize(file.size) }}</td>
                <td data-col="at" class="muted">{{ file.createdAt || '—' }}</td>
                <td data-col="actions">
                  <div class="files-actions">
                    <a class="btn btn-ghost btn-sm" :href="fileContentUrl(file.id)" :download="file.name">
                      <Download :size="14" />
                      {{ t('filesDownload') }}
                    </a>
                    <button class="btn btn-ghost btn-sm" @click="pendingDelete = file.id">
                      <Trash2 :size="14" />
                      {{ t('filesDelete') }}
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="pendingDelete === file.id" class="files-row-confirm">
                <td colspan="4">
                  <div class="row" style="justify-content: space-between; gap: 8px">
                    <span>{{ t('filesDeleteConfirm').replace('{name}', file.name) }}</span>
                    <div class="row" style="gap: 8px">
                      <button class="btn btn-ghost btn-sm" @click="pendingDelete = ''">
                        {{ t('filesCancel') }}
                      </button>
                      <button class="btn btn-danger btn-sm" :disabled="deleting === file.id" @click="confirmDelete(file.id)">
                        {{ t('filesDelete') }}
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>
