import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLinkageStore, type Device, type DeviceType, type Rule } from './linkage'

export const KNOWN_TYPES: DeviceType[] = ['感烟探测器', '感温探测器', '手动报警按钮', '输入模块', '输出模块', '排烟风机', '防火卷帘', '消防广播', '电梯']

export type MigrationIssue = '地址重复' | '类型未知' | '延时单位不明' | '引用未知点位'
export type CutoverIssue = '地址重复占用' | '跨区变化'
export type BatchStatus = '待确认' | '试运行' | '已切换' | '已回滚'

export type MigrationDeviceItem = {
  key: string
  oldId: string
  name: string
  rawType: string
  type: DeviceType | null
  floor: string
  zone: string
  address: string
  issues: MigrationIssue[]
  confirmed: boolean
  discarded: boolean
  newId: string | null
}

export type MigrationRuleItem = {
  key: string
  oldRuleId: string
  triggerOldId: string
  actionOldId: string
  rawDelay: string
  delay: number | null
  issues: MigrationIssue[]
  confirmed: boolean
  discarded: boolean
  newId: string | null
}

export type ReviewItem = { id: string; title: string; pointId: string; pointName: string; status: '继续' | '退回'; reason: string }
export type Signature = { user: string; action: string; at: string }
export type CutoverFlag = { deviceId: string; deviceName: string; issues: CutoverIssue[] }

export type MigrationBatch = {
  id: string
  source: string
  createdAt: string
  hash: string
  status: BatchStatus
  deviceItems: MigrationDeviceItem[]
  ruleItems: MigrationRuleItem[]
  trialRevision: string | null
  signatures: Signature[]
  snapshot: { devices: Device[]; rules: Rule[]; revision: number } | null
  reconfirmRuleIds: string[]
  cutoverFlags: CutoverFlag[]
  reviewItems: ReviewItem[]
}

const STORAGE_KEY = 'fire-linkage-migration-v1'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function now() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function normalizeBackup(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .join('\n')
}

function hashText(text: string) {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  return `H${hash.toString(16).padStart(8, '0')}`
}

function parseDelay(raw: string): { delay: number | null; unclear: boolean } {
  const text = raw.trim().toLowerCase()
  const ms = text.match(/^(\d+(?:\.\d+)?)\s*ms$/)
  if (ms) return { delay: Number(ms[1]) / 1000, unclear: false }
  const sec = text.match(/^(\d+(?:\.\d+)?)\s*s$/)
  if (sec) return { delay: Number(sec[1]), unclear: false }
  return { delay: null, unclear: true }
}

export const useMigrationStore = defineStore('migration', () => {
  const linkage = useLinkageStore()
  const saved = localStorage.getItem(STORAGE_KEY)
  const restored = saved ? (JSON.parse(saved) as { batches: MigrationBatch[] }) : null
  const batches = ref<MigrationBatch[]>(restored?.batches ?? [])
  const selectedBatchId = ref<string | null>(null)

  watch(batches, () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ batches: batches.value }))
  }, { deep: true })

  const selectedBatch = computed(() => batches.value.find((batch) => batch.id === selectedBatchId.value) ?? null)
  const activeTrialBatch = computed(() => batches.value.find((batch) => batch.status === '试运行') ?? null)
  const flaggedDevices = computed(() => {
    const map = new Map<string, CutoverIssue[]>()
    batches.value.filter((batch) => batch.status === '已切换').forEach((batch) => {
      batch.cutoverFlags.forEach((flag) => map.set(flag.deviceId, flag.issues))
    })
    return map
  })
  const pendingReconfirmCount = computed(() => batches.value.reduce((count, batch) => count + batch.reconfirmRuleIds.length, 0))

  function pushSignature(batch: MigrationBatch, user: string, action: string) {
    batch.signatures.push({ user, action, at: now() })
  }

  function pendingDevices(batch: MigrationBatch) {
    return batch.deviceItems.filter((item) => !item.confirmed && !item.discarded)
  }

  function pendingRules(batch: MigrationBatch) {
    return batch.ruleItems.filter((item) => !item.confirmed && !item.discarded)
  }

  function allResolved(batch: MigrationBatch) {
    return pendingDevices(batch).length === 0 && pendingRules(batch).length === 0
  }

  function recheckRuleItems(batch: MigrationBatch) {
    const deviceIds = new Set(batch.deviceItems.filter((item) => !item.discarded).map((item) => item.oldId))
    const ledgerIds = new Set(linkage.devices.map((device) => device.id))
    batch.ruleItems.filter((item) => !item.discarded).forEach((item) => {
      const issues: MigrationIssue[] = []
      if (item.delay === null) issues.push('延时单位不明')
      if (!deviceIds.has(item.triggerOldId) && !ledgerIds.has(item.triggerOldId)) issues.push('引用未知点位')
      else if (!deviceIds.has(item.actionOldId) && !ledgerIds.has(item.actionOldId)) issues.push('引用未知点位')
      item.issues = issues
    })
  }

  function recheckDeviceItem(batch: MigrationBatch, item: MigrationDeviceItem) {
    const issues: MigrationIssue[] = []
    if (!item.type) issues.push('类型未知')
    const duplicated = linkage.devices.some((device) => device.address === item.address)
      || batch.deviceItems.some((other) => other.key !== item.key && !other.discarded && other.address === item.address)
    if (duplicated) issues.push('地址重复')
    item.issues = issues
  }

  function parseBackup(text: string) {
    const deviceItems: MigrationDeviceItem[] = []
    const ruleItems: MigrationRuleItem[] = []
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith('#'))
    const usedAddresses = new Set(linkage.devices.map((device) => device.address))
    let skipped = 0
    lines.forEach((line, index) => {
      const cells = line.split(/[,，]/).map((cell) => cell.trim())
      if (cells.length >= 6) {
        const [oldId, name, rawType, floor, zone, address] = cells
        const issues: MigrationIssue[] = []
        const type = KNOWN_TYPES.includes(rawType as DeviceType) ? (rawType as DeviceType) : null
        if (!type) issues.push('类型未知')
        if (usedAddresses.has(address)) issues.push('地址重复')
        usedAddresses.add(address)
        deviceItems.push({ key: `D${index}`, oldId, name, rawType, type, floor, zone, address, issues, confirmed: issues.length === 0, discarded: false, newId: null })
      } else if (cells.length === 4) {
        const [oldRuleId, triggerOldId, actionOldId, rawDelay] = cells
        const { delay, unclear } = parseDelay(rawDelay)
        ruleItems.push({ key: `R${index}`, oldRuleId, triggerOldId, actionOldId, rawDelay, delay, issues: unclear ? ['延时单位不明'] : [], confirmed: false, discarded: false, newId: null })
      } else {
        skipped += 1
      }
    })
    const batch = { deviceItems, ruleItems } as MigrationBatch
    recheckRuleItems(batch)
    ruleItems.forEach((item) => { item.confirmed = item.issues.length === 0 })
    return { deviceItems, ruleItems, skipped }
  }

  function nextBatchId() {
    const seq = batches.value.reduce((max, batch) => Math.max(max, Number(batch.id.replace('MB-', '')) || 0), 0) + 1
    return `MB-${String(seq).padStart(2, '0')}`
  }

  function submitBackup(text: string, source: string) {
    const hash = hashText(normalizeBackup(text))
    const existing = batches.value.find((batch) => batch.hash === hash)
    // 幂等：重复提交同一备份只保留第一次解析结果
    if (existing) {
      selectedBatchId.value = existing.id
      return { batch: existing, duplicated: true, skipped: 0 }
    }
    const { deviceItems, ruleItems, skipped } = parseBackup(text)
    const batch: MigrationBatch = {
      id: nextBatchId(),
      source: source || '旧主机备份',
      createdAt: now(),
      hash,
      status: '待确认',
      deviceItems,
      ruleItems,
      trialRevision: null,
      signatures: [],
      snapshot: null,
      reconfirmRuleIds: [],
      cutoverFlags: [],
      reviewItems: [],
    }
    const pendingCount = pendingDevices(batch).length + pendingRules(batch).length
    pushSignature(batch, '调试组', `提交备份解析：直接对应 ${deviceItems.length + ruleItems.length - pendingCount} 项，待确认 ${pendingCount} 项`)
    batches.value.push(batch)
    selectedBatchId.value = batch.id
    return { batch, duplicated: false, skipped }
  }

  function confirmDeviceItem(batchId: string, key: string, patch?: Partial<Pick<MigrationDeviceItem, 'type' | 'address' | 'zone' | 'floor'>>) {
    const batch = batches.value.find((item) => item.id === batchId)
    const item = batch?.deviceItems.find((entry) => entry.key === key)
    if (!batch || !item || item.confirmed || item.discarded) return
    if (patch) Object.assign(item, patch)
    recheckDeviceItem(batch, item)
    // 类型未知必须选定类型后才能确认；地址重复允许原样保留，留待切换后核查
    if (!item.type) return
    item.confirmed = true
    recheckRuleItems(batch)
  }

  function confirmRuleItem(batchId: string, key: string, patch?: Partial<Pick<MigrationRuleItem, 'delay' | 'triggerOldId' | 'actionOldId'>>) {
    const batch = batches.value.find((item) => item.id === batchId)
    const item = batch?.ruleItems.find((entry) => entry.key === key)
    if (!batch || !item || item.confirmed || item.discarded) return
    if (patch) Object.assign(item, patch)
    recheckRuleItems(batch)
    // 延时单位和引用点位必须明确后才能确认
    if (item.delay === null || item.issues.includes('引用未知点位')) return
    item.confirmed = true
  }

  function discardItem(batchId: string, key: string) {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch) return
    const device = batch.deviceItems.find((entry) => entry.key === key)
    if (device) device.discarded = true
    const rule = batch.ruleItems.find((entry) => entry.key === key)
    if (rule) rule.discarded = true
    recheckRuleItems(batch)
  }

  function generateTrialRevision(batchId: string) {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch || batch.status !== '待确认' || !allResolved(batch)) return
    if (linkage.activeTrialBatchId) return
    batch.snapshot = { devices: clone(linkage.devices), rules: clone(linkage.rules), revision: linkage.revision }
    const idMap = new Map<string, string>()
    batch.deviceItems.filter((item) => !item.discarded).forEach((item) => {
      let newId = item.oldId
      while (linkage.devices.some((device) => device.id === newId)) newId = `${item.oldId}-M`
      idMap.set(item.oldId, newId)
      item.newId = newId
      linkage.devices.push({ id: newId, name: item.name, type: item.type as DeviceType, floor: item.floor, zone: item.zone, address: item.address, batchId, trial: true })
    })
    let seq = linkage.rules.reduce((max, rule) => Math.max(max, Number(rule.id.replace('R-', '')) || 0), 0)
    batch.ruleItems.filter((item) => !item.discarded).forEach((item) => {
      seq += 1
      const newId = `R-${String(seq).padStart(3, '0')}`
      item.newId = newId
      linkage.rules.push({
        id: newId,
        triggerId: idMap.get(item.triggerOldId) ?? item.triggerOldId,
        actionId: idMap.get(item.actionOldId) ?? item.actionOldId,
        delay: item.delay ?? 0,
        interlock: '无',
        priority: 2,
        suppression: '无',
        enabled: true,
        legacyId: item.oldRuleId,
        batchId,
        trial: true,
      })
    })
    batch.trialRevision = `R${linkage.revision}-T${batch.id.replace('MB-', '')}`
    batch.status = '试运行'
    linkage.activeTrialBatchId = batchId
    linkage.trialDirty = false
    pushSignature(batch, '调试组', `确认迁移内容，生成试运行修订 ${batch.trialRevision}（旧规则编号保留可查）`)
  }

  function cutover(batchId: string) {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch || batch.status !== '试运行') return
    const importedDevices = linkage.devices.filter((device) => device.batchId === batchId)
    const flags: CutoverFlag[] = []
    importedDevices.forEach((device) => {
      const issues: CutoverIssue[] = []
      if (linkage.devices.some((other) => other.id !== device.id && other.address === device.address)) issues.push('地址重复占用')
      const prefix = device.address.split('-').slice(0, 2).join('-')
      const neighborZones = new Set(linkage.devices.filter((other) => other.batchId !== batchId && other.address.startsWith(prefix)).map((other) => other.zone))
      if (neighborZones.size > 0 && !neighborZones.has(device.zone)) issues.push('跨区变化')
      if (issues.length > 0) flags.push({ deviceId: device.id, deviceName: device.name, issues })
    })
    batch.cutoverFlags = flags
    const flaggedIds = new Set(flags.map((flag) => flag.deviceId))
    batch.reconfirmRuleIds = linkage.rules
      .filter((rule) => flaggedIds.has(rule.triggerId) || flaggedIds.has(rule.actionId))
      .map((rule) => rule.id)
    batch.reconfirmRuleIds.forEach((ruleId) => {
      const rule = linkage.rules.find((item) => item.id === ruleId)
      if (rule) rule.needsReconfirm = true
    })
    // 点位失效的审阅项退回，其余继续使用
    batch.reviewItems = importedDevices.map((device) => {
      const flag = flags.find((item) => item.deviceId === device.id)
      return {
        id: `${batchId}-PT-${device.id}`,
        title: `点位核对 ${device.name}`,
        pointId: device.id,
        pointName: device.name,
        status: flag ? '退回' : '继续',
        reason: flag ? flag.issues.join('、') : '',
      }
    })
    importedDevices.forEach((device) => { device.trial = false })
    linkage.rules.filter((rule) => rule.batchId === batchId).forEach((rule) => { rule.trial = false })
    linkage.revision += 1
    linkage.activeTrialBatchId = null
    linkage.trialDirty = false
    batch.status = '已切换'
    pushSignature(batch, '消防审阅人', flags.length > 0 ? `切换上线，${flags.length} 个点位异常，${batch.reconfirmRuleIds.length} 条规则待重新确认` : '切换上线，无遗留问题')
  }

  function reconfirmRule(batchId: string, ruleId: string) {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch || !batch.reconfirmRuleIds.includes(ruleId)) return
    const rule = linkage.rules.find((item) => item.id === ruleId)
    if (rule) rule.needsReconfirm = false
    batch.reconfirmRuleIds = batch.reconfirmRuleIds.filter((id) => id !== ruleId)
    pushSignature(batch, '调试组', `重新确认规则 ${rule?.legacyId ? `${rule.legacyId}（${ruleId}）` : ruleId}`)
  }

  function rollbackBatch(batchId: string) {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch || batch.status === '已回滚' || batch.status === '待确认') return
    if (batch.snapshot) {
      linkage.devices = clone(batch.snapshot.devices)
      linkage.rules = clone(batch.snapshot.rules)
      linkage.revision = batch.snapshot.revision
    }
    if (linkage.activeTrialBatchId === batchId) {
      linkage.activeTrialBatchId = null
      linkage.trialDirty = false
    }
    batch.reviewItems = batch.reviewItems.map((item) => ({ ...item, status: '退回' as const, reason: '批次已回滚，点位已移除' }))
    batch.reconfirmRuleIds = []
    batch.status = '已回滚'
    pushSignature(batch, '项目负责人', `迁移失败，按批次号 ${batchId} 恢复旧基线`)
  }

  function findLegacyRule(oldRuleId: string) {
    const query = oldRuleId.trim()
    if (!query) return null
    for (const batch of batches.value) {
      const item = batch.ruleItems.find((entry) => entry.oldRuleId === query)
      if (item) {
        const rule = item.newId ? linkage.rules.find((entry) => entry.id === item.newId) ?? null : null
        return { batch, item, rule }
      }
    }
    return null
  }

  return {
    batches,
    selectedBatchId,
    selectedBatch,
    activeTrialBatch,
    flaggedDevices,
    pendingReconfirmCount,
    pendingDevices,
    pendingRules,
    allResolved,
    submitBackup,
    confirmDeviceItem,
    confirmRuleItem,
    discardItem,
    generateTrialRevision,
    cutover,
    reconfirmRule,
    rollbackBatch,
    findLegacyRule,
  }
})
