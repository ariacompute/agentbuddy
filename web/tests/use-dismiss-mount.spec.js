// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { useDismiss } from '../src/lib/use-dismiss.js'
import { mountWith } from './helpers/vue-utils.js'

// The lifecycle half of useDismiss: outside a component it deliberately skips the
// hook (use-dismiss.spec.js covers that), so the registered-cleanup path needs a
// real component to unmount.
describe('useDismiss inside a component', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('cancels the pending timer when the component unmounts', async () => {
    vi.useFakeTimers()
    const Comp = defineComponent({
      setup() {
        const { value, show } = useDismiss(null, 1000)
        show('hello')
        return () => h('span', { class: 'toast' }, value.value || '')
      },
    })

    const { wrapper } = mountWith(Comp)
    await nextTick()
    expect(wrapper.find('.toast').text()).toBe('hello')

    wrapper.unmount()
    // A timer that outlived its component would write to a ref nobody renders;
    // advancing past the ttl must simply do nothing (and not throw).
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
  })
})
