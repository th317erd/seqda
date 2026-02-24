# `seqda` - Sequential Data Store

## Install

NPM:
```bash
npm i --save seqda
```

Yarn:
```bash
yarn add seqda
```

## About

`seqda` is a Redux-like global store. Unlike Redux, it doesn't take boiler-plate with the mass of a black-hole to setup, and has a much simpler interface.

There are no actions, dispatches, reducers, or selectors per-se. Instead, there are just methods: getters and setters that the user defines. **All** methods are cached, so calling the same method over and over again with the same state and the same argument will simply return the same previous cached result. If you need to invalidate the cache (i.e. on a setter, when you are for some reason continually providing the same input), simply add another randomized argument to invalidate the cache. The cache is always automatically invalidated for all methods in a scope when the state is updated (but only for the scope that had its state updated).

## Creating a data store

In `seqda` there are a few key principles that will be mentioned throughout this document. Let's create a simple store to explain these principles and terminology:

```javascript
import { createStore } from 'seqda';

const MyStore = createStore({
  todos: { // This is a "scope"
    _: [], // This is the "default value" for this scope

    // Then you simply define methods to interact with this data
    add({ get, set }, todo /* ...args, as provided by the user */) {
      // get = fetch the current data from
      // the store for this scope

      // set = update the data on the store
      // for this scope

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
  // Define another scope
  config: {
    _: {
      configValue1: null,
      configValue2: null,
    },
    // You can also define sub-scopes
    userConfig: {
      _: {
        firstName: '',
        lastName: '',
      },

      // Methods go here
    },

    // Methods go here
  }
});

// We can add a todo by calling our method
// (notice that the "context" arguments ({ get, set })
// are provided internally by seqda)

MyStore.todos.add({ todo: 'Do things!', id: 1 });

console.log(MyStore.getState());
// {
//   "todos": [
//     { "todo": "Do things!", "id": 1 }
//   ],
//   "config": {
//     "configValue1": null,
//     "configValue2": null,
//     "userConfig": {
//       "firstName": "",
//       "lastName": ""
//     }
//   }
// }
```

## Immutability

In `seqda`, the store's internal state tree is frozen with `Object.freeze`. This ensures structural immutability — the state can only be updated through scope methods via `set()`.

```javascript
let state = MyStore.getState();
state.setSomething = toAValue;
// TypeError: Cannot add property setSomething, object is not extensible
```

**Important:** The freeze is *shallow* — it applies to the state tree nodes (objects and arrays at each path level) but does **not** deep-freeze objects stored as values inside those containers. For example, if you store an object inside an array scope, the array is frozen (you can't push/pop), but the object itself remains mutable:

```javascript
import { createStore } from 'seqda';

const store = createStore({
  items: {
    _: [],
    add({ get, set }, item) {
      set([...get(), item]);
    },
    get({ get }) {
      return get();
    },
  },
});

let item = { name: 'test', mutable: true };
store.items.add(item);

let items = store.items.get();
items.push('fail');              // TypeError — array is frozen
items[0].name = 'modified';     // Works — item object is NOT frozen
```

This is by design. It keeps seqda lightweight and allows consumers to manage their own object immutability strategy (e.g., `Object.freeze` at the application level, or treating objects as immutable by convention).

## Method cache

All scope methods in `seqda` are cached by default. For this reason, it is fine to have getters that contain complex logic and filtering.

The cache is invalidated as soon as 1) the internal state for a scope is updated via `set()`, or 2) the arguments to the method call change.

Let's see an example of this in action:

```javascript
import { createStore } from 'seqda';

const MyStore = createStore({
  citizens: {
    _: [],
    getByState({ get }, shortStateName) {
      return get().filter((citizen) => (citizen.state === shortStateName));
    },
  },
  states: {
    _: [],
    get({ get }, stateName) {
      if (!stateName)
        return get();

      return get().find((state) => (state.name === stateName));
    },
    getCitizensForState({ get, store }, stateName) {
      let state = store.states.get(stateName);
      // Cached — as long as shortStateName stays the same,
      // repeated calls return instantly.
      let citizens = store.citizens.getByState(state.shortName);
      return citizens;
    }
  },
});
```

## Update events

`seqda` emits an `'update'` event when the store has been updated. Unlike Redux, the `'update'` event is only triggered on the *next microtask* (via `Promise.resolve().then(...)`). The update event reports which scopes were modified, and provides a frozen read-only snapshot of the previous state. This allows many store updates to happen sequentially, with only one event fired.

*Note: When the scope name in the `modified` array is `'*'`, the entire store has been updated (e.g., via `.hydrate()`).*

```javascript
import { createStore } from 'seqda';

const MyStore = createStore({
  todos: {
    _: [],
    add({ get, set }, todo) {
      set([ ...get(), todo ]);
    },
    get({ get }) {
      return get();
    },
  },
});

MyStore.on('update', ({ store, previousStore, modified }) => {
  console.log('modified scopes:', modified);
  // modified scopes: [ 'todos' ]

  // previousStore is a frozen read-only clone of the state
  // before this batch of updates:
  console.log('before:', previousStore.todos.get());
  console.log('after:', store.todos.get());
});

// Both adds happen in the same synchronous block —
// only ONE update event fires, listing 'todos' once.
MyStore.todos.add({ todo: 'Do something!', id: 1 });
MyStore.todos.add({ todo: 'Do another thing!', id: 2 });
```

### Sub-scope paths in `modified`

When a sub-scope is updated, the `modified` array contains the dot-separated path to that specific sub-scope:

```javascript
import { createStore } from 'seqda';

const store = createStore({
  data: {
    _: [],
    config: {
      _: { theme: 'dark' },
      set({ get, set }, values) {
        set({ ...get(), ...values });
      },
    },
  },
});

store.on('update', ({ modified }) => {
  console.log(modified);
  // [ 'data.config' ]  — the specific sub-scope path
});

store.data.config.set({ theme: 'light' });
```

### Custom events

The seqda store IS a Node.js `EventEmitter`. You can emit your own custom events through it alongside seqda's built-in events. Custom events fire **synchronously** (unlike seqda's batched `update` event):

```javascript
import { createStore } from 'seqda';

const store = createStore({
  items: {
    _: {},
    put({ get, set }, item) {
      set({ ...get(), [item.id]: item });
    },
  },
});

// Subscribe to a custom namespaced event
store.on('item:added:abc123', (data) => {
  console.log('Item added:', data.item);
});

// Your wrapper can emit custom events synchronously
// during operations, while seqda handles state batching:
let item = { id: 'abc123', name: 'test' };
store.items.put(item);
store.emit(`item:added:${item.id}`, { item });
```

## Fetch events

`seqda` can report which scopes are being read. Enable with `{ emitOnFetch: true }` and listen for the `'fetchScope'` event:

```javascript
import { createStore } from 'seqda';

const MyStore = createStore({
  todos: {
    _: [],
    add({ get, set }, todo) {
      set([ ...get(), todo ]);
    },
    get({ get }) {
      return get();
    },
  },
}, { emitOnFetch: true });

MyStore.todos.add({ todo: 'Do something!', id: 1 });

MyStore.on('fetchScope', ({ store, scopeName }) => {
  console.log('scope fetched:', scopeName);
});

MyStore.todos.get();
// output: scope fetched: todos
```

## Async methods

There is nothing in `seqda` preventing you from using async methods. The store will only update once `set` is called inside a method, and `set` won't be called until your asynchronous code is complete.

```javascript
import { createStore } from 'seqda';

const MyStore = createStore({
  users: {
    _: [],
    async getUser({ get, set }, userID) {
      let users = get();
      let user = users[userID];

      if (!user) {
        user = await API.getUserByID(userID);
        set({ ...users, [user.id]: user });
      }

      return user;
    }
  },
});

let user = await MyStore.users.getUser(1);
```

Keep in mind that methods inside `seqda` are not asynchronous in nature, so the result of the above `getUser` call will cache the returned promise (not the resolved value of that promise). Now this shouldn't be an issue, because if you have an asynchronous method, you will always be awaiting on the result, so the cached promise--if returned from cache--will provide the same result.

```javascript
// Caches the promise
let user = await MyStore.users.getUser(1);

// Returns the cached promise
user = await MyStore.users.getUser(1);

// Result = same
```

## Performance

Unlike Redux, where dispatching an action recalculates the entire store, `seqda` only updates the specific scope (and its parent path) that was modified. Combined with per-method caching and batched update events, this makes `seqda` efficient for high-frequency updates.

The `'update'` event fires once per microtask tick after all synchronous writes settle. If you have UI components listening for store updates, they re-render once after the batch — not once per write.

## Cloning stores

You can clone a store with `cloneStore()`. Cloned stores are fully independent — mutations in the clone don't affect the original.

```javascript
import { createStore, cloneStore } from 'seqda';

const store = createStore({
  todos: {
    _: [],
    add({ get, set }, todo) {
      set([...get(), todo]);
    },
    get({ get }) {
      return get();
    },
  },
});

store.todos.add({ id: 1, text: 'Original' });

// Mutable clone
let clone = cloneStore(store);
clone.todos.add({ id: 2, text: 'Clone only' });

console.log(store.todos.get().length);  // 1
console.log(clone.todos.get().length);  // 2

// Read-only clone (set() calls are silently ignored)
let snapshot = cloneStore(store, true);
snapshot.todos.add({ id: 3, text: 'Ignored' });
console.log(snapshot.todos.get().length);  // 1
```

## Hydrating the store

To restore a store from a saved state, use `hydrate()`. This replaces the entire internal state atomically and emits an update with `modified: ['*']`.

```javascript
let savedState = JSON.stringify(MyStore.getState());

// Later...
MyStore.hydrate(JSON.parse(savedState));
```

`hydrate()` also invalidates all scope method caches, so any subsequent calls to cached methods will re-read from the new state.

## Middleware

Middleware is not currently supported, but I would be happy to add it (or to accept a PR) if anyone needs middleware.

## API Reference

### `createStore(template, options?)`

Creates a new seqda store.

- **`template`** — Object defining scopes. Each scope has a `_` default value and named methods.
- **`options.emitOnFetch`** — `boolean` (default: `false`). When `true`, emits `'fetchScope'` events on scope reads.

Returns the store instance (an `EventEmitter` with scope methods attached).

### Store instance

| Method/Property | Description |
|---|---|
| `store.getState()` | Returns the current frozen internal state object |
| `store.hydrate(state)` | Replaces entire state, emits update with `modified: ['*']` |
| `store.on(event, listener)` | Subscribe to events (inherited from EventEmitter) |
| `store.off(event, listener)` | Unsubscribe from events |
| `store.emit(event, data)` | Emit custom events |

### Scope method context

Every scope method receives a context object as its first argument:

| Property | Description |
|---|---|
| `get()` | Read the current state for this scope |
| `set(value)` | Write a new value for this scope (must be a different reference) |
| `store` | Reference to the root store — access other scopes |

### Events

| Event | Payload | Timing |
|---|---|---|
| `'update'` | `{ store, previousStore, modified }` | Async (next microtask), batched |
| `'fetchScope'` | `{ store, scopeName }` | Sync (immediate), opt-in |
| Custom events | User-defined | Sync (immediate) |

### `cloneStore(store, readOnly?)`

Creates a deep clone of the store. If `readOnly` is `true`, all `set()` calls are silently ignored.
