/* eslint-disable no-magic-numbers */
import { createStore, cloneStore } from '../src/index.js';

/* global describe, it, expect, beforeEach */

/**
 * Exploratory tests for seqda in the context of a FrameManager.
 *
 * These tests verify seqda's suitability as the state foundation for
 * a FrameManager module that manages typed, immutable, event-sourced frames.
 *
 * Key concerns to verify:
 * 1. Object.freeze depth — are referenced objects (Frames) frozen?
 * 2. Event granularity — what does `modified` report?
 * 3. Custom events — can FrameManager emit its own events via the store?
 * 4. Scope patterns — how to organize frame collections?
 * 5. Cache behavior under rapid writes
 * 6. hydrate() for bulk loading
 * 7. previousStore diffing
 */

describe('Seqda for FrameManager', () => {
  // =========================================================================
  // 1. OBJECT.FREEZE DEPTH
  // =========================================================================

  describe('Object.freeze behavior', () => {
    it('freezes the array container stored in state', () => {
      let store = createStore({
        frames: {
          _: [],
          add({ get, set }, frame) {
            set([...get(), frame]);
          },
          get({ get }) {
            return get();
          },
        },
      });

      store.frames.add({ id: 'f1', type: 'message', content: { text: 'hello' } });
      let frames = store.frames.get();

      // The array itself should be frozen (can't push)
      expect(() => frames.push({ id: 'f2' })).toThrow();
    });

    it('does NOT deep-freeze objects inside the array (shallow freeze)', () => {
      let store = createStore({
        frames: {
          _: [],
          add({ get, set }, frame) {
            set([...get(), frame]);
          },
          get({ get }) {
            return get();
          },
        },
      });

      let frame = { id: 'f1', type: 'message', content: { text: 'hello' } };
      store.frames.add(frame);

      let storedFrames = store.frames.get();
      let storedFrame = storedFrames[0];

      // The frame object inside the array — is it frozen or mutable?
      // seqda uses Object.freeze on the finalValue (the array), but
      // Object.freeze is SHALLOW. So the frame object should be mutable.
      let isFrozen = Object.isFrozen(storedFrame);

      // Document the actual behavior:
      // If frozen=true, we need FramePointer workaround for linked-list pointers
      // If frozen=false, Frame objects are mutable and pointers work directly
      console.log(`  [FREEZE TEST] Frame inside array is frozen: ${isFrozen}`);

      // Test if we can mutate the frame's properties
      if (!isFrozen) {
        storedFrame.previous = 'some-id';
        expect(storedFrame.previous).toBe('some-id');
        // Clean up
        delete storedFrame.previous;
      }
    });

    it('verifies freeze depth on nested content objects', () => {
      let store = createStore({
        frames: {
          _: [],
          add({ get, set }, frame) {
            set([...get(), frame]);
          },
          get({ get }) {
            return get();
          },
        },
      });

      let frame = {
        id: 'f1',
        content: {
          text: 'hello',
          nested: { deep: 'value' },
        },
      };
      store.frames.add(frame);

      let storedFrame = store.frames.get()[0];
      let isFrameFrozen = Object.isFrozen(storedFrame);
      let isContentFrozen = Object.isFrozen(storedFrame.content);
      let isNestedFrozen = Object.isFrozen(storedFrame.content.nested);

      console.log(`  [FREEZE DEPTH] frame frozen: ${isFrameFrozen}`);
      console.log(`  [FREEZE DEPTH] frame.content frozen: ${isContentFrozen}`);
      console.log(`  [FREEZE DEPTH] frame.content.nested frozen: ${isNestedFrozen}`);
    });

    it('verifies freeze behavior with object (non-array) scope', () => {
      let store = createStore({
        frameMap: {
          _: {},
          put({ get, set }, id, frame) {
            set({ ...get(), [id]: frame });
          },
          get({ get }, id) {
            if (id === undefined)
              return get();

            return get()[id];
          },
        },
      });

      let frame = { id: 'f1', type: 'message', content: { text: 'hi' } };
      store.frameMap.put('f1', frame);

      let map = store.frameMap.get();
      let storedFrame = store.frameMap.get('f1');

      console.log(`  [FREEZE MAP] map frozen: ${Object.isFrozen(map)}`);
      console.log(`  [FREEZE MAP] frame in map frozen: ${Object.isFrozen(storedFrame)}`);
    });
  });

  // =========================================================================
  // 2. EVENT GRANULARITY
  // =========================================================================

  describe('Event granularity', () => {
    it('reports scope-level paths in modified array', async () => {
      let store = createStore({
        frames: {
          _: [],
          add({ get, set }, frame) {
            set([...get(), frame]);
          },
          get({ get }) {
            return get();
          },
        },
        metadata: {
          _: {},
          set({ set }, values) {
            set(values);
          },
        },
      });

      let result = await new Promise((resolve) => {
        store.on('update', ({ modified }) => {
          resolve(modified);
        });

        store.frames.add({ id: 'f1', type: 'message' });
      });

      console.log(`  [EVENT GRANULARITY] modified after frames.add: ${JSON.stringify(result)}`);

      // Does modified say ['frames'] or something more specific?
      expect(result).toContain('frames');
    });

    it('reports multiple scopes when multiple scopes are updated', async () => {
      let store = createStore({
        frames: {
          _: [],
          add({ get, set }, frame) {
            set([...get(), frame]);
          },
          get({ get }) {
            return get();
          },
        },
        metadata: {
          _: { count: 0 },
          increment({ get, set }) {
            let current = get();
            set({ ...current, count: current.count + 1 });
          },
        },
      });

      let result = await new Promise((resolve) => {
        store.on('update', ({ modified }) => {
          resolve(modified);
        });

        // Update both scopes in the same tick
        store.frames.add({ id: 'f1' });
        store.metadata.increment();
      });

      console.log(`  [MULTI-SCOPE] modified: ${JSON.stringify(result)}`);

      // Should contain both scope names
      expect(result).toContain('frames');
      expect(result).toContain('metadata');
    });

    it('reports sub-scope paths for nested scopes', async () => {
      let store = createStore({
        frames: {
          _: [],
          add({ get, set }, frame) {
            set([...get(), frame]);
          },
          index: {
            _: {},
            put({ get, set }, id, frame) {
              set({ ...get(), [id]: frame });
            },
          },
        },
      });

      let result = await new Promise((resolve) => {
        store.on('update', ({ modified }) => {
          resolve(modified);
        });

        store.frames.index.put('f1', { id: 'f1' });
      });

      console.log(`  [SUB-SCOPE] modified for frames.index.put: ${JSON.stringify(result)}`);

      // Does it report 'frames.index' or just 'frames'?
    });

    it('batches multiple writes in same tick into single event', async () => {
      let store = createStore({
        frames: {
          _: [],
          add({ get, set }, frame) {
            set([...get(), frame]);
          },
          get({ get }) {
            return get();
          },
        },
      });

      let eventCount = 0;

      let result = await new Promise((resolve) => {
        store.on('update', ({ modified }) => {
          eventCount++;
          resolve({ modified, eventCount });
        });

        // Three adds in the same synchronous block
        store.frames.add({ id: 'f1' });
        store.frames.add({ id: 'f2' });
        store.frames.add({ id: 'f3' });
      });

      console.log(`  [BATCHING] events fired: ${result.eventCount}, modified: ${JSON.stringify(result.modified)}`);

      // Should batch into single event
      expect(result.eventCount).toBe(1);
      // All three adds are in the same scope, so modified should be ['frames']
      expect(result.modified).toEqual(['frames']);
      // But all three frames should be in the store
      expect(store.frames.get().length).toBe(3);
    });
  });

  // =========================================================================
  // 3. CUSTOM EVENTS
  // =========================================================================

  describe('Custom events', () => {
    it('can emit custom events through the store (it IS an EventEmitter)', (done) => {
      let store = createStore({
        frames: {
          _: [],
          get({ get }) {
            return get();
          },
        },
      });

      // seqda store IS an EventEmitter — can we emit our own events?
      store.on('frame:added', (data) => {
        expect(data.frame.id).toBe('f1');
        done();
      });

      store.emit('frame:added', { frame: { id: 'f1', type: 'message' } });
    });

    it('can emit namespaced events for ID-scoped subscriptions', (done) => {
      let store = createStore({
        frames: {
          _: [],
          get({ get }) {
            return get();
          },
        },
      });

      let frameId = 'f1';

      store.on(`frame:updated:${frameId}`, (data) => {
        expect(data.frame.id).toBe(frameId);
        expect(data.previousContent).toEqual({ text: 'hello' });
        done();
      });

      // Simulate FrameManager emitting a namespaced event
      store.emit(`frame:updated:${frameId}`, {
        frame: { id: frameId, content: { text: 'world' } },
        previousContent: { text: 'hello' },
      });
    });

    it('custom events do not interfere with seqda update events', async () => {
      let store = createStore({
        frames: {
          _: [],
          add({ get, set }, frame) {
            set([...get(), frame]);
          },
          get({ get }) {
            return get();
          },
        },
      });

      let customReceived = false;
      let updateReceived = false;

      store.on('frame:added', () => {
        customReceived = true;
      });

      let result = await new Promise((resolve) => {
        store.on('update', ({ modified }) => {
          updateReceived = true;
          resolve(modified);
        });

        // Emit custom event AND update state in same tick
        store.emit('frame:added', { frame: { id: 'f1' } });
        store.frames.add({ id: 'f1', type: 'message' });
      });

      expect(customReceived).toBe(true);
      expect(updateReceived).toBe(true);
      expect(result).toContain('frames');
    });

    it('custom events fire synchronously (unlike seqda update)', () => {
      let store = createStore({
        frames: {
          _: [],
          get({ get }) {
            return get();
          },
        },
      });

      let received = false;

      store.on('frame:added', () => {
        received = true;
      });

      store.emit('frame:added', { frame: { id: 'f1' } });

      // Should be true IMMEDIATELY (synchronous), not on next tick
      expect(received).toBe(true);
    });
  });

  // =========================================================================
  // 4. SCOPE ORGANIZATION PATTERNS
  // =========================================================================

  describe('Scope organization for frames', () => {
    it('can use a Map-like scope for frame storage by ID', () => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            if (id === undefined)
              return get();

            return get()[id];
          },
          remove({ get, set }, id) {
            let current = { ...get() };
            delete current[id];
            set(current);
          },
          all({ get }) {
            return Object.values(get());
          },
        },
      });

      store.frames.put({ id: 'f1', type: 'message', content: { text: 'hello' } });
      store.frames.put({ id: 'f2', type: 'command', content: { cmd: 'ls' } });
      store.frames.put({ id: 'f3', type: 'message', content: { text: 'world' } });

      expect(store.frames.get('f1').type).toBe('message');
      expect(store.frames.get('f2').type).toBe('command');
      expect(store.frames.all().length).toBe(3);

      store.frames.remove('f2');
      expect(store.frames.get('f2')).toBeUndefined();
      expect(store.frames.all().length).toBe(2);
    });

    it('can use separate scopes for frames and frame pointers', () => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            if (id === undefined)
              return get();

            return get()[id];
          },
        },
        pointers: {
          _: {},
          set({ get, set }, id, pointer) {
            set({ ...get(), [id]: pointer });
          },
          get({ get }, id) {
            if (id === undefined)
              return get();

            return get()[id];
          },
          getHead({ get }, id) {
            let pointer = get()[id];
            if (!pointer)
              return undefined;

            return pointer.head ? pointer.head.frame : pointer.frame;
          },
        },
      });

      // Store a frame
      let frame1 = { id: 'f1', type: 'message', content: { text: 'v1' } };
      store.frames.put(frame1);
      store.pointers.set('f1', { frame: frame1, previous: null, next: null, head: null, tail: null });

      // Merge creates a new version
      let frame1v2 = { id: 'f1-v2', type: 'message', content: { text: 'v2' } };
      store.frames.put(frame1v2);

      let oldPointer = store.pointers.get('f1');
      let newPointer = {
        frame: frame1v2,
        previous: oldPointer,
        next: null,
        head: null,
        tail: oldPointer,
      };
      // Update head on old pointer to point to new
      oldPointer.head = newPointer;

      store.pointers.set('f1', newPointer);

      // Verify head
      expect(store.pointers.getHead('f1')).toBe(frame1v2);
      // Verify we can walk backwards
      let current = store.pointers.get('f1');
      expect(current.frame.content.text).toBe('v2');
      expect(current.previous.frame.content.text).toBe('v1');
    });

    it('can organize by parent-child with children scope', () => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            return id === undefined ? get() : get()[id];
          },
        },
        children: {
          _: {},
          add({ get, set }, parentId, childId) {
            let current = get();
            let list = current[parentId] ? [...current[parentId], childId] : [childId];
            set({ ...current, [parentId]: list });
          },
          get({ get, store }, parentId) {
            let childIds = get()[parentId] || [];
            return childIds.map((id) => store.frames.get(id)).filter(Boolean);
          },
        },
      });

      store.frames.put({ id: 'interaction-1', type: 'interaction', parentId: null });
      store.frames.put({ id: 'msg-1', type: 'message', parentId: 'interaction-1', content: { text: 'hello' } });
      store.frames.put({ id: 'msg-2', type: 'message', parentId: 'interaction-1', content: { text: 'world' } });

      store.children.add('interaction-1', 'msg-1');
      store.children.add('interaction-1', 'msg-2');

      let childFrames = store.children.get('interaction-1');
      expect(childFrames.length).toBe(2);
      expect(childFrames[0].content.text).toBe('hello');
      expect(childFrames[1].content.text).toBe('world');
    });
  });

  // =========================================================================
  // 5. CACHE BEHAVIOR
  // =========================================================================

  describe('Cache behavior', () => {
    it('invalidates cache when state changes', () => {
      let computeCount = 0;

      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          sorted({ get }) {
            computeCount++;
            return Object.values(get()).sort((a, b) => a.order - b.order);
          },
        },
      });

      store.frames.put({ id: 'f2', order: 2 });
      store.frames.put({ id: 'f1', order: 1 });

      computeCount = 0;

      // First call — cache miss
      let sorted1 = store.frames.sorted();
      expect(computeCount).toBe(1);
      expect(sorted1[0].id).toBe('f1');
      expect(sorted1[1].id).toBe('f2');

      // Second call — cache hit
      let sorted2 = store.frames.sorted();
      expect(computeCount).toBe(1); // No recompute
      expect(sorted2).toBe(sorted1); // Same reference

      // Add a new frame — cache should invalidate
      store.frames.put({ id: 'f3', order: 0 });
      let sorted3 = store.frames.sorted();
      expect(computeCount).toBe(2); // Recomputed
      expect(sorted3[0].id).toBe('f3'); // New frame is first
    });

    it('handles rapid writes (simulating streaming)', () => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            return get()[id];
          },
        },
      });

      // Simulate 100 rapid phantom merges (like streaming)
      let groupFrame = { id: 'group-1', type: 'message', content: { text: '' } };
      store.frames.put(groupFrame);

      for (let i = 0; i < 100; i++) {
        let currentFrame = store.frames.get('group-1');
        let updatedFrame = {
          ...currentFrame,
          content: { text: currentFrame.content.text + `chunk${i} ` },
        };
        store.frames.put(updatedFrame);
      }

      let finalFrame = store.frames.get('group-1');
      expect(finalFrame.content.text).toContain('chunk0');
      expect(finalFrame.content.text).toContain('chunk99');
    });
  });

  // =========================================================================
  // 6. HYDRATE
  // =========================================================================

  describe('hydrate() for bulk loading', () => {
    it('can hydrate a store with pre-existing frame state', async () => {
      let store = createStore({
        frames: {
          _: {},
          get({ get }, id) {
            return id === undefined ? get() : get()[id];
          },
          all({ get }) {
            return Object.values(get());
          },
        },
        children: {
          _: {},
          get({ get }, parentId) {
            return get()[parentId] || [];
          },
        },
      });

      // Simulate loading from database
      let savedState = {
        frames: {
          'f1': { id: 'f1', type: 'interaction', parentId: null, content: {} },
          'f2': { id: 'f2', type: 'message', parentId: 'f1', content: { text: 'hello' } },
          'f3': { id: 'f3', type: 'message', parentId: 'f1', content: { text: 'world' } },
        },
        children: {
          'f1': ['f2', 'f3'],
        },
      };

      let result = await new Promise((resolve) => {
        store.on('update', ({ modified }) => {
          resolve(modified);
        });

        store.hydrate(savedState);
      });

      // hydrate should report '*' as modified
      expect(result).toContain('*');

      // Verify state was loaded
      expect(store.frames.all().length).toBe(3);
      expect(store.frames.get('f2').content.text).toBe('hello');
      expect(store.children.get('f1')).toEqual(['f2', 'f3']);
    });

    it('hydrate replaces entire state (not merge)', () => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            return id === undefined ? get() : get()[id];
          },
          all({ get }) {
            return Object.values(get());
          },
        },
      });

      // Add some frames
      store.frames.put({ id: 'f1', type: 'message' });
      store.frames.put({ id: 'f2', type: 'message' });
      expect(store.frames.all().length).toBe(2);

      // Hydrate with different state
      store.hydrate({
        frames: {
          'f3': { id: 'f3', type: 'command' },
        },
      });

      // get() with new args = cache miss, reads from new state correctly
      expect(store.frames.get('f1')).toBeUndefined();
      expect(store.frames.get('f2')).toBeUndefined();
      expect(store.frames.get('f3').type).toBe('command');

      // FIX VERIFIED: hydrate() now properly invalidates all scope caches.
      // Previously, all() would return stale cached result (length 2).
      // Now it correctly returns the hydrated state.
      expect(store.frames.all().length).toBe(1);
      expect(store.frames.all()[0].id).toBe('f3');

      // Raw state also confirms hydrate replaced state:
      let rawState = store.getState();
      expect(Object.keys(rawState.frames).length).toBe(1);
      expect(rawState.frames['f3'].type).toBe('command');
    });
  });

  // =========================================================================
  // 7. PREVIOUSSTORE DIFFING
  // =========================================================================

  describe('previousStore diffing', () => {
    it('previousStore reflects state before the current batch of updates', async () => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            return id === undefined ? get() : get()[id];
          },
          all({ get }) {
            return Object.values(get());
          },
        },
      });

      store.frames.put({ id: 'f1', type: 'message', content: { text: 'original' } });

      // Wait for first update to settle
      await new Promise((resolve) => {
        store.on('update', function handler() {
          store.off('update', handler);
          resolve();
        });
      });

      // Now update the frame
      let result = await new Promise((resolve) => {
        store.on('update', ({ previousStore }) => {
          resolve({
            previousFrame: previousStore.frames.get('f1'),
            currentFrame: store.frames.get('f1'),
          });
        });

        store.frames.put({ id: 'f1', type: 'message', content: { text: 'updated' } });
      });

      expect(result.previousFrame.content.text).toBe('original');
      expect(result.currentFrame.content.text).toBe('updated');
    });

    it('can detect which specific frames changed via previousStore diff', async () => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            return id === undefined ? get() : get()[id];
          },
        },
      });

      store.frames.put({ id: 'f1', type: 'message', content: { text: 'hello' } });
      store.frames.put({ id: 'f2', type: 'message', content: { text: 'world' } });

      // Wait for first update
      await new Promise((resolve) => {
        store.on('update', function handler() {
          store.off('update', handler);
          resolve();
        });
      });

      // Now update just one frame
      let result = await new Promise((resolve) => {
        store.on('update', ({ previousStore }) => {
          // Diff: find which frame IDs changed
          let prevFrames = previousStore.frames.get();
          let currFrames = store.frames.get();

          let changedIds = [];
          for (let id of Object.keys(currFrames)) {
            if (!prevFrames[id] || prevFrames[id] !== currFrames[id]) {
              changedIds.push(id);
            }
          }

          resolve(changedIds);
        });

        store.frames.put({ id: 'f1', type: 'message', content: { text: 'CHANGED' } });
      });

      console.log(`  [DIFF] Changed frame IDs: ${JSON.stringify(result)}`);

      // Only f1 should show as changed
      expect(result).toContain('f1');
      expect(result).not.toContain('f2');
    });
  });

  // =========================================================================
  // 8. MERGE PATTERN (FrameManager wrapper simulation)
  // =========================================================================

  describe('FrameManager merge pattern simulation', () => {
    it('simulates a full merge operation with custom events', (done) => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            return id === undefined ? get() : get()[id];
          },
        },
      });

      // Simulate FrameManager.merge() behavior:
      // 1. Add the frame to the store
      // 2. Emit a synchronous custom event
      // 3. seqda will later emit batched 'update'

      let eventsReceived = [];

      store.on('frame:added:f1', (data) => {
        eventsReceived.push('frame:added:f1');
      });

      store.on('update', () => {
        eventsReceived.push('update');

        // Custom event should have fired BEFORE seqda's batched update
        expect(eventsReceived).toEqual(['frame:added:f1', 'update']);
        done();
      });

      // Simulate merge():
      let frame = { id: 'f1', type: 'message', content: { text: 'hello' } };
      store.frames.put(frame);
      store.emit(`frame:added:${frame.id}`, { frame });
    });

    it('simulates deep merge of content between frames', () => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            return id === undefined ? get() : get()[id];
          },
        },
      });

      // Create target frame
      store.frames.put({
        id: 'target-1',
        type: 'hml-prompt',
        content: { question: 'Allow shell?', options: ['yes', 'no'], answered: false },
        hidden: true,
        deleted: false,
      });

      // Deep merge: simulating a permission response
      let target = store.frames.get('target-1');
      let mergedContent = { ...target.content, answered: true, response: 'yes' };
      let mergedFrame = { ...target, content: mergedContent, hidden: false, updatedAt: Date.now() };
      store.frames.put(mergedFrame);

      let result = store.frames.get('target-1');
      expect(result.content.question).toBe('Allow shell?');
      expect(result.content.answered).toBe(true);
      expect(result.content.response).toBe('yes');
      expect(result.hidden).toBe(false);
    });

    it('simulates phantom/live frame streaming with immediate collapse', () => {
      let store = createStore({
        frames: {
          _: {},
          put({ get, set }, frame) {
            set({ ...get(), [frame.id]: frame });
          },
          get({ get }, id) {
            return id === undefined ? get() : get()[id];
          },
        },
      });

      // First phantom creates the group frame
      let phantom1 = {
        phantom: true,
        groupId: 'group-1',
        groupType: 'message',
        parentId: 'interaction-1',
        content: { text: 'He' },
      };

      // FrameManager logic: create group frame from first phantom
      let groupFrame = {
        id: phantom1.groupId,
        type: phantom1.groupType,
        parentId: phantom1.parentId,
        content: { ...phantom1.content },
        phantom: false,
        hidden: true,
        deleted: false,
      };
      store.frames.put(groupFrame);

      // Second phantom merges into group
      let phantom2 = { phantom: true, groupId: 'group-1', content: { text: 'Hello' } };
      let current = store.frames.get('group-1');
      store.frames.put({ ...current, content: { ...current.content, ...phantom2.content } });

      // Third phantom
      let phantom3 = { phantom: true, groupId: 'group-1', content: { text: 'Hello World' } };
      current = store.frames.get('group-1');
      store.frames.put({ ...current, content: { ...current.content, ...phantom3.content } });

      let final = store.frames.get('group-1');
      expect(final.id).toBe('group-1');
      expect(final.type).toBe('message');
      expect(final.content.text).toBe('Hello World');
      expect(final.phantom).toBe(false);
      expect(final.hidden).toBe(true);
      expect(final.parentId).toBe('interaction-1');
    });
  });
});
