/* eslint-disable no-magic-numbers */
'use strict';

const Nife = require('nife');
const { createStore, cloneStore } = require('../src');

/* global describe, it, expect, beforeEach, spyOn */

describe('Store Simple', () => {
  let store;

  beforeEach(() => {
    store = createStore({
      todos: {
        _: [],
        add({ get, set }, todo) {
          set([ ...get(), todo ]);
        },
        update({ get, set, store }, todoID, todo) {
          let foundTodo = store.todos.get(todoID);
          if (!foundTodo)
            return;

          let todos = get();
          if (!todos)
            return;

          let index = todos.findIndex((todo) => (todo === foundTodo));
          if (index < 0)
            return;

          todos = todos.slice();
          todos[index] = todo;

          set(todos);
        },
        bad({ get }) {
          let todos = get();
          todos.push('Test');
        },
        remove({ get, set }, todo) {
          set(get().filter((item) => (item !== todo)));
        },
        get({ get }, todoID) {
          if (arguments.length === 1)
            return get();

          return get().find((todo) => (todo.id === todoID));
        },
        getTodosForAssignee({ get, store }, assigneeNameOrID) {
          let assignee = store.assignees.get(assigneeNameOrID)[0];
          if (!assignee)
            return [];

          return get().filter((todo) => (todo.assigneeID === assignee.id));
        },
      },
      assignees: {
        _: [],
        add({ get, set }, assignee) {
          set([ ...get(), assignee ]);
        },
        remove({ get, set }, assignee) {
          set(get().filter((item) => (item !== assignee)));
        },
        get({ get }, nameOrID) {
          if (arguments.length === 1)
            return get();

          return get().filter(({ name, id }) => (name === nameOrID || id === nameOrID));
        },
      },
      scope: {
        _: {
          test: true,
        },
        set({ get, set }, values) {
          return set({ ...get(), ...values });
        },
        get({ get }) {
          return get();
        },
      },
    }, { emitOnFetch: true });
  });

  it('can add and fetch items from the store', () => {
    store.assignees.add({ name: 'John', id: 1 });
    store.assignees.add({ name: 'Bob', id: 2 });
    store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    store.todos.add({ description: 'Make it work!', assigneeID: 1, id: 2 });
    store.todos.add({ description: 'Make it happen!', assigneeID: 2, id: 3 });
    store.todos.add({ description: 'Do the thing!', assigneeID: 2, id: 4 });

    expect(store.todos.get()).toEqual([
      { description: 'Git r\' done!', assigneeID: 1, id: 1 },
      { description: 'Make it work!', assigneeID: 1, id: 2 },
      { description: 'Make it happen!', assigneeID: 2, id: 3 },
      { description: 'Do the thing!', assigneeID: 2, id: 4 },
    ]);

    expect(store.todos.getTodosForAssignee('John')).toEqual([
      { description: 'Git r\' done!', assigneeID: 1, id: 1 },
      { description: 'Make it work!', assigneeID: 1, id: 2 },
    ]);
  });

  it('can will cache results', () => {
    store.assignees.add({ name: 'John', id: 1 });
    store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    store.todos.add({ description: 'Make it work!', assigneeID: 1, id: 2 });

    spyOn(Nife, 'get').and.callThrough();

    // Not cached
    store.todos.get();

    // Cached
    store.todos.get();
    store.todos.get();
    store.todos.get();
    store.todos.get();

    expect(Nife.get.calls.count()).toEqual(1);
  });

  it('will fail if we attempt to assign to the state directly', () => {
    store.assignees.add({ name: 'John', id: 1 });
    store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });

    let state = store.getState();
    expect(state).toEqual({
      assignees:  [
        { name: 'John', id: 1 },
      ],
      todos:      [
        { description: 'Git r\' done!', assigneeID: 1, id: 1 },
      ],
      scope: {
        test: true,
      },
    });

    expect(() => store.todos.bad()).toThrow(new TypeError('Cannot add property 1, object is not extensible'));
  });

  it('can get global state', () => {
    store.assignees.add({ name: 'John', id: 1 });
    store.assignees.add({ name: 'Bob', id: 2 });
    store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    store.todos.add({ description: 'Make it happen!', assigneeID: 2, id: 2 });

    let state = store.getState();
    expect(state).toEqual({
      assignees:  [
        { name: 'John', id: 1 },
        { name: 'Bob', id: 2 },
      ],
      todos:      [
        { description: 'Git r\' done!', assigneeID: 1, id: 1 },
        { description: 'Make it happen!', assigneeID: 2, id: 2 },
      ],
      scope: {
        test: true,
      },
    });

    store.todos.update(2, { description: 'Make it happen!', assigneeID: 1, id: 2 });

    let newState = store.getState();
    expect(newState).not.toBe(state);
    expect(newState).toEqual({
      assignees:  [
        { name: 'John', id: 1 },
        { name: 'Bob', id: 2 },
      ],
      todos:      [
        { description: 'Git r\' done!', assigneeID: 1, id: 1 },
        { description: 'Make it happen!', assigneeID: 1, id: 2 },
      ],
      scope: {
        test: true,
      },
    });
  });

  it('will not fire update event if nothing has changed', async () => {
    let updateCounter = 0;

    let result = await new Promise((resolve) => {
      const onUpdate = ({ modified, previousStore }) => {
        updateCounter++;
        resolve(modified);
      };

      store.on('update', onUpdate);

      store.scope.set({ test: false });
    });

    expect(result).toEqual([ 'scope' ]);
    expect(updateCounter).toEqual(1);

    updateCounter = 0;
    result = await new Promise((resolve) => {
      const onUpdate = ({ modified, previousStore }) => {
        updateCounter++;
        resolve(modified);
      };

      store.on('update', onUpdate);

      store.scope.set({ test: false });

      setTimeout(() => resolve([]), 150);
    });

    expect(result).toEqual([]);
    expect(updateCounter).toEqual(0);
  });

  it('can update store inside update event', async () => {
    let updateCounter = 0;

    let result = await new Promise((resolve) => {
      let totalModified = [];

      const onUpdate = ({ modified, previousStore }) => {
        updateCounter++;

        if (updateCounter === 1) {
          expect(previousStore.todos.get()).toEqual([]);
          store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
        } else {
          expect(previousStore.todos.get()).toEqual([]);
        }

        totalModified = totalModified.concat(modified);
        if (updateCounter > 1)
          resolve(totalModified);
      };

      store.on('update', onUpdate);

      store.assignees.add({ name: 'John', id: 1 });
    });

    expect(store.todos.get()).toEqual([
      { description: 'Git r\' done!', assigneeID: 1, id: 1 },
    ]);

    expect(result).toEqual([
      'assignees',
      'todos',
    ]);

    expect(updateCounter).toEqual(2);
  });

  it('can listen for change events', async () => {
    let result = await new Promise((resolve) => {
      const onUpdate = ({ modified, previousStore }) => {
        expect(previousStore.getState().assignees).toEqual([]);
        expect(previousStore.getState().todos).toEqual([]);

        resolve(modified);

        store.off('update', onUpdate);
      };

      store.on('update', onUpdate);

      store.assignees.add({ name: 'John', id: 1 });
      store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    });

    expect(result).toEqual([
      'assignees',
      'todos',
    ]);

    let ranUpdateEvent = false;

    await new Promise((resolve) => {
      const onUpdate = ({ modified, previousStore }) => {
        expect(previousStore.getState().assignees).toEqual([
          { name: 'John', id: 1 },
        ]);

        expect(previousStore.getState().todos).toEqual([
          { description: 'Git r\' done!', assigneeID: 1, id: 1 },
        ]);

        resolve(modified);

        store.off('update', onUpdate);

        ranUpdateEvent = true;
      };

      store.on('update', onUpdate);

      store.assignees.add({ name: 'Bob', id: 2 });
      store.todos.add({ description: 'Work harder bob!', assigneeID: 2, id: 2 });
    });

    expect(ranUpdateEvent).toBe(true);
  });

  it('can listen for scopes being fetched', async () => {
    store.assignees.add({ name: 'John', id: 1 });
    store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });

    let results = [];

    store.on('fetchScope', ({ scopeName }) => {
      if (results.indexOf(scopeName) < 0)
        results.push(scopeName);
    });

    store.todos.get();

    expect(results).toEqual([
      'todos',
    ]);
  });

  it('can clone a store', async () => {
    store.assignees.add({ name: 'John', id: 1 });
    store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });

    let initialState = store.getState();

    let clonedStore = cloneStore(store);
    clonedStore.assignees.add({ name: 'Bob', id: 2 });
    clonedStore.todos.add({ description: 'Work harder please!', assigneeID: 2, id: 2 });

    expect(store.getState()).toBe(initialState);
    expect(store.getState()).toEqual(initialState);

    let clonedState = clonedStore.getState();
    expect(clonedState).not.toEqual(initialState);
    expect(clonedState.assignees).toEqual([
      { name: 'John', id: 1 },
      { name: 'Bob', id: 2 },
    ]);

    expect(clonedState.todos).toEqual([
      { description: 'Git r\' done!', assigneeID: 1, id: 1 },
      { description: 'Work harder please!', assigneeID: 2, id: 2 },
    ]);
  });

  it('can clone a read-only store', async () => {
    store.assignees.add({ name: 'John', id: 1 });
    store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });

    let initialState = store.getState();

    let clonedStore = cloneStore(store, true);
    clonedStore.assignees.add({ name: 'Bob', id: 2 });
    clonedStore.todos.add({ description: 'Work harder please!', assigneeID: 2, id: 2 });

    expect(store.getState()).toBe(initialState);
    expect(store.getState()).toEqual(initialState);

    let clonedState = clonedStore.getState();
    expect(clonedState).toEqual(initialState);
    expect(clonedState.assignees).toEqual([
      { name: 'John', id: 1 },
    ]);

    expect(clonedState.todos).toEqual([
      { description: 'Git r\' done!', assigneeID: 1, id: 1 },
    ]);
  });
});
