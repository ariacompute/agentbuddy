// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import BaseDialog from '../src/components/BaseDialog.vue'

// The dialog teleports to <body>, so these assertions read the document rather
// than the wrapper: that is where the user's clicks and Tab presses land.
const panel = () => document.querySelector('.dialog-card')
const backdrop = () => document.querySelector('.dialog-backdrop')
const dialogButtons = () => [...document.querySelectorAll('.dialog-card button')]

function mountClosed() {
  return mount(BaseDialog, {
    props: { modelValue: false, title: 'Settings', closeLabel: 'Close' },
    slots: { default: '<p class="dialog-copy">body</p>', footer: '<button class="ok">ok</button>' },
    attachTo: document.body,
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('BaseDialog', () => {
  it('renders nothing until it is opened', async () => {
    const wrapper = mountClosed()
    expect(backdrop()).toBeNull()

    await wrapper.setProps({ modelValue: true })
    await nextTick()

    expect(panel()).not.toBeNull()
    expect(panel().getAttribute('role')).toBe('dialog')
    expect(panel().getAttribute('aria-modal')).toBe('true')
    expect(panel().getAttribute('aria-label')).toBe('Settings')
    expect(document.querySelector('.dialog-copy')).not.toBeNull()
    expect(document.querySelector('.dialog-foot')).not.toBeNull()
    wrapper.unmount()
  })

  it('omits the footer when the caller has no slot for it', async () => {
    const wrapper = mount(BaseDialog, {
      props: { modelValue: true, title: 'Plain' },
      slots: { default: 'body' },
      attachTo: document.body,
    })
    await nextTick()
    expect(panel()).not.toBeNull()
    expect(document.querySelector('.dialog-foot')).toBeNull()
    wrapper.unmount()
  })

  it('closes from the header button, the backdrop, and Escape', async () => {
    const wrapper = mountClosed()
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    // The close button names itself from closeLabel, falling back to the title.
    const closeBtn = document.querySelector('.dialog-close')
    expect(closeBtn.getAttribute('aria-label')).toBe('Close')
    closeBtn.click()
    await nextTick()
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(wrapper.emitted('close')).toHaveLength(1)

    // A click on the backdrop itself closes; one inside the card does not.
    backdrop().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(2)

    panel().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(2)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(3)
    wrapper.unmount()
  })

  it('falls back to the title when no close label is given', async () => {
    const wrapper = mount(BaseDialog, {
      props: { modelValue: true, title: 'Untitled' },
      attachTo: document.body,
    })
    await nextTick()
    expect(document.querySelector('.dialog-close').getAttribute('aria-label')).toBe('Untitled')
    wrapper.unmount()
  })

  it('keeps Tab inside the panel and wraps at both ends', async () => {
    const wrapper = mountClosed()
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    const [close, ok] = dialogButtons()
    // jsdom reports every element as having no offsetParent, which the dialog
    // reads as "not visible"; declaring one keeps the focusable list populated.
    for (const el of [close, ok]) {
      Object.defineProperty(el, 'offsetParent', { value: document.body, configurable: true })
    }

    ok.focus()
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(forward)
    expect(forward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)

    close.focus()
    const backward = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(backward)
    expect(backward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(ok)

    // A Tab from outside the list is left to the browser.
    const stray = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.activeElement.blur()
    document.dispatchEvent(stray)
    expect(stray.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('focuses the first control on open and returns focus on close', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'open'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const wrapper = mountClosed()
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    expect(document.activeElement).toBe(document.querySelector('.dialog-close'))

    await wrapper.setProps({ modelValue: false })
    await nextTick()
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('leaves Tab alone when nothing in the panel is visible', async () => {
    // jsdom reports no offsetParent, which the dialog reads as "hidden". With no
    // focusable control it must not swallow the key: a trap on an empty list is
    // a keyboard trap that never opens.
    const wrapper = mountClosed()
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('stops listening once it is unmounted', async () => {
    const wrapper = mountClosed()
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    wrapper.unmount()

    // No listener means no emit and, more importantly, no throw from a stale
    // handler touching a panel that no longer exists.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
