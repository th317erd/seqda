'use strict';

const { createStore } = require('../src');

/* global describe, it, expect, beforeEach */

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
    });
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
    });
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
    });

    expect(() => store.todos.bad()).toThrow(new TypeError('Cannot add property 1, object is not extensible'));
  });

  it('can listen for change events', async () => {
    let result = await new Promise((resolve) => {
      store.on('update', ({ modified }) => {
        resolve(modified);
      });

      store.assignees.add({ name: 'John', id: 1 });
      store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });
    });

    expect(result).toEqual([
      'todos',
      'assignees',
    ]);
  });

  it('can listen for scopes being fetched', async () => {
    store.assignees.add({ name: 'John', id: 1 });
    store.todos.add({ description: 'Git r\' done!', assigneeID: 1, id: 1 });

    let results = [];

    store.on('fetchScope', ({ scopeName }) => {
      results.push(scopeName);
    });

    store.todos.get();

    expect(results).toEqual([
      'todos',
    ]);
  });
});
