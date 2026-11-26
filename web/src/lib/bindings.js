// Binding helpers for the abilities screen.
//
// agenthub keeps an agent's abilities on the agent itself: kind_config.agent.mcp
// and kind_config.agent.skills are arrays of resource ids. PUT
// /api/resources/{id} replaces the whole record — the handler decodes a complete
// Entry and Upsert copies every field — so a save has to start from the record as
// the server has it and change exactly those two arrays.
//
// This module is deliberately free of Vue and of the network: the merge rules are
// the part worth testing, and they are the part that is easy to get wrong.

/**
 * Drops blanks and duplicates while keeping the order the caller had.
 * Binding arrays are compared and rendered in order, so sorting would make an
 * untouched list look edited.
 */
export function normalizeRefs(refs) {
  if (!Array.isArray(refs)) return []
  const seen = new Set()
  const out = []
  for (const raw of refs) {
    const ref = typeof raw === 'string' ? raw.trim() : ''
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    out.push(ref)
  }
  return out
}

/** Adds an id to a selection or removes it, leaving the rest in order. */
export function toggleRef(refs, id) {
  const list = normalizeRefs(refs)
  if (!id) return list
  return list.includes(id) ? list.filter((ref) => ref !== id) : [...list, id]
}

/**
 * Ids that are selected but absent from the candidate list.
 *
 * They are not a UI accident: the record may be invisible to this caller (it
 * answers 404 by design) or the binding may predate the picker. Dropping them
 * silently would turn "I cannot see it" into "it was never bound", so the screen
 * keeps them and lets the operator decide.
 */
export function unresolvedRefs(selected, options) {
  const offered = new Set((options || []).map((option) => option && option.id).filter(Boolean))
  return normalizeRefs(selected).filter((id) => !offered.has(id))
}

/**
 * The body a binding save puts to /api/resources/{id}.
 *
 * Everything except the two arrays comes back exactly as the server sent it,
 * which is what makes a whole-record PUT safe:
 *
 * - `status` is stated instead of left empty. agenthub resolves an empty status
 *   to the namespace default, and a reviewed namespace defaults to `pending` —
 *   so omitting it would silently send an approved agent back to the queue.
 * - Fields the screen never touches (`persona`, `visibility`, `metadata`,
 *   `health`, the rest of kind_config.agent such as card_url, credential_env and
 *   egress_allowlist) are carried through untouched.
 * - An empty array removes the key rather than writing `[]`: kind_config is
 *   serialized as a union, and "no binding" is the absent field.
 */
export function withBindings(entry, { mcp, skills }) {
  if (!entry || !entry.id) throw new Error('withBindings needs a complete resource')
  const config = entry.kind_config && typeof entry.kind_config === 'object' ? { ...entry.kind_config } : {}
  const agent = config.agent && typeof config.agent === 'object' ? { ...config.agent } : {}

  const nextMCP = normalizeRefs(mcp)
  const nextSkills = normalizeRefs(skills)
  if (nextMCP.length) agent.mcp = nextMCP
  else delete agent.mcp
  if (nextSkills.length) agent.skills = nextSkills
  else delete agent.skills
  config.agent = agent

  return {
    ...entry,
    kind_config: config,
    status: entry.status || 'approved',
  }
}

/** The two selections an entry currently carries, as the screen edits them. */
export function bindingsOf(entry) {
  const agent = entry?.kind_config?.agent
  return {
    mcp: normalizeRefs(agent?.mcp),
    skills: normalizeRefs(agent?.skills),
  }
}

/** True when a draft would change the record, so the save button can stay quiet. */
export function bindingsDiffer(entry, draft) {
  const current = bindingsOf(entry)
  const next = {
    mcp: normalizeRefs(draft?.mcp),
    skills: normalizeRefs(draft?.skills),
  }
  return current.mcp.join('\u0000') !== next.mcp.join('\u0000') ||
    current.skills.join('\u0000') !== next.skills.join('\u0000')
}
