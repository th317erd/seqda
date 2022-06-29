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
const { createStore } = require('seqda');
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
})

// We can add a todo by calling our method
// (notice that the "context") argments ({ get, set })
// are provided internally by seqda

MyStore.todos.add(/* todo */ { todo: 'Do things!', id: 1 });

console.log(MyStore.getState());

{
  "todos": [
    { "todo": "Do things!", "id": 1 },
  ],
  "config": {
    "configValue1": null,
    "configValue2": null,
    'userConfig": {
      "firstName": '',
      "lastName": '',
    }
  }
}
```

## The entire store is frozen

In `seqda`, all values in the store are always frozen with `Object.freeze`. This ensures that your store stays immutable, and can only be updated with the provided scope methods. For example, if you try to set something directly on the returned state, it will fail:

```javascript
let state = MyStore.getState();
state.setSomething = toAValue;

// throw new TypeError('Cannot add property setSomething, object is not extensible');
```

## Method cache

All scope methods in `seqda` are cached by default. For this reason, it is fine to have getters that contain complex logic and filtering.

The cache is invalidated as soon as 1) the internal state for a scope is updated, or 2) the arguments to the method call change.

Let's see an example of this in action:

```javascript
const { createStore } = require('seqda');

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
        return get(); // if no stateName was provided, then return all states

      return get().find((state) => (state.name === stateName));
    },
    getCitizensForState({ get, store }, stateName) {
      // First, get the state requested from the store
      let state = store.states.get(stateName);

      // Next get the citizens for this state
      // This is now cached, so as long as the
      // arguments (shortStateName) remain the
      // same, we can quickly call this over and over.
      let citizens = store.citizens.getByState(state.shortName);
      return citizens;
    }
  },
});
```

## Update events

`seqda` emits an `'update'` event when the store has been updated. Unlike Redux, the `'update'` event is only triggered on the *next frame* in the Javascript engine (essentially on `nextTick`). The update event also reports which areas of the store have been updated, unlike Redux. This allows many store updates to happen sequentially, with the update event only being fired once. Let's see an example of this in action.

*Note: When the scope name of the update event is `'*'`, this means that the entire store has been updated. This can happen for example when the store is hydrated with a `.hydrate` call.*

```javascript
const { createStore } = require('seqda');
const MyStore = createStore({
  todos: {
    _: [],
    add({ get, set }, todo) {
      set([ ...get(), todo ]);
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
});

MyStore.on('update', ({ store, modified }) => {
  // I am called on `nextTick`, frame 2
  console.log('modified: ', modified);

  // modified: [ 'todos' ]
});

// frame 1
MyStore.todos.add({ todo: 'Do something!', id: 1 });
MyStore.todos.add({ todo: 'Do another thing!', id: 2 });

//... now onto frame2, where the "update" event is fired
```

## Fetch events

`seqda` also reports which scopes are being fetched. Simply listen for the "fetchScope" event to know which areas of the store have been accessed for any given operation.

```javascript
const { createStore } = require('seqda');

const MyStore = createStore({
  todos: {
    _: [],
    add({ get, set }, todo) {
      set([ ...get(), todo ]);
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
});

MyStore.todos.add({ todo: 'Do something!', id: 1 });
MyStore.todos.add({ todo: 'Do another thing!', id: 2 });

MyStore.on('fetchScope', ({ store, scopeName }) => {
  console.log('scope fetched: ', scopeName);
});

MyStore.todos.get();

// output:
// scoped fetched: todos
```

## Async methods

There is nothing in `seqda` preventing you from using async methods. The store will only update once `set` is called inside a method, and `set` won't be called until your asynchronous code is complete.

```javascript
const { createStore } = require('seqda');

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

let user = await MyStore.getUser(1);
```

Keep in mind that methods inside `seqda` are not asynchronous in nature, so the result of the above `getUser` call will cache the returned promise (not the resolved value of that promise). Now this shouldn't be an issue, because if you have an asynchronous method, so you will always be awaiting on the result, so the cached promise--if returned from cache--will provide the same result.

```javascript
// Caches the promise
let user = await MyStore.getUser(1);

// Returns the cached promise
user = await MyStore.getUser(1);

// Result = same
```

## Seqda is built for speed an simplicity

Unlike in Redux, where when an action is dispatched, the entire store is recalculated (which can be very heavy for large stores), `seqda` will only update the specific area of the store (and all its parent scopes) that was requested to be updated. This means that for each update operation, only the updated scope (and all parent) scopes are updated, making it much more efficient than Redux.

Also, as already mentioned, the `seqda` `'update'` event is only fired once after all the store updates have settled (on `nextTick` after updates). This is also for efficiency purposes. For example, if you have client components (i.e. React) listening for store updates, then unlike Redux, where the component's state will potentially update dozens of times for a single store dispatch, in `seqda` all your components will only update their state once after the store has settled.

The `seqda` interface was designed to be simple and intuitive. All you really need to understand is scopes, and how to interact with them via `get`, `set`, and fetching other values from the store via `store`. The rest is up to you! Feel free to create complicated caching selectors, or any other useful tools you want. You just need to provide methods to interact with your scopes, and the rest is left to your creative freedom!

## Middleware

Middleware is not currently supported, but I would be happy to add it (or to accept a PR) if anyone needs middleware.

## Hydrating the store from a stored state

To hydrate your store from a stored state, simply call `MyStore.hydrate(storedState)`.

```javascript

let storedState = JSON.stringify(MyStore.getState());

MyStore.hydrate(JSON.parse(storedState));

```
