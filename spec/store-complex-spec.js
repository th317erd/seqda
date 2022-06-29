'use strict';

const { createStore } = require('../src');

/* global describe, it, expect, beforeEach */

describe('Store Complex', () => {
  let store;

  beforeEach(() => {
    store = createStore({
      items: {
        _:        [],
        subItems: {
          _: {
            key1: true,
            key2: 'hello',
            key3: 10,
          },
          update({ get, set, store }, values) {
            set(Object.assign({}, get(), values || {}));
          },
          get({ get }) {
            return get();
          },
        },
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
        remove({ get, set }, todo) {
          set(get().filter((item) => (item !== todo)));
        },
        get({ get }, todoID) {
          if (arguments.length === 1)
            return get();

          return get().find((todo) => (todo.id === todoID));
        },
      },
      values: {
        _: {
          here:   'yes',
          there:  'no',
        },
        subValues: {
          _: {
            test:   true,
            hello:  'world',
          },
          update({ get, set }, values) {
            set(Object.assign({}, get(), values || {}));
          },
        },
        update({ get, set }, values) {
          set(Object.assign({}, get(), values || {}));
        },
      },
    });
  });

  it('can add and fetch items from the store', () => {
    store.items.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    store.items.add({ description: 'Make it work!', assigneeID: 1, id: 2 });
    store.items.add({ description: 'Make it happen!', assigneeID: 2, id: 3 });
    store.items.add({ description: 'Do the thing!', assigneeID: 2, id: 4 });

    let items = store.items.get();
    expect(items[0]).toEqual({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    expect(items[1]).toEqual({ description: 'Make it work!', assigneeID: 1, id: 2 });
    expect(items[2]).toEqual({ description: 'Make it happen!', assigneeID: 2, id: 3 });
    expect(items[3]).toEqual({ description: 'Do the thing!', assigneeID: 2, id: 4 });

    expect(store.getState().values).toEqual({
      here:       'yes',
      there:      'no',
      subValues:  { test: true, hello: 'world' },
    });
  });

  it('can get global state #1', () => {
    store.items.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    store.items.add({ description: 'Make it happen!', assigneeID: 2, id: 2 });
    store.items.subItems.update({ test: 'stuff' });

    let state = store.getState();
    expect(state.items[0]).toEqual({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    expect(state.items[1]).toEqual({ description: 'Make it happen!', assigneeID: 2, id: 2 });

    expect(state.items.subItems).toEqual({
      key1: true,
      key2: 'hello',
      key3: 10,
      test: 'stuff',
    });
  });

  it('can get global state', () => {
    store.items.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    store.items.add({ description: 'Make it happen!', assigneeID: 2, id: 2 });
    store.items.subItems.update({ test: 'stuff' });

    let state = store.getState();
    expect(state.items[0]).toEqual({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    expect(state.items[1]).toEqual({ description: 'Make it happen!', assigneeID: 2, id: 2 });

    expect(state.items.subItems).toEqual({
      key1: true,
      key2: 'hello',
      key3: 10,
      test: 'stuff',
    });
  });
});
