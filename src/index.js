'use strict';

const Nife          = require('nife');
const EventEmitter  = require('events');

const INTERNAL_GET_STATE    = Symbol.for('__seqdaGetState');
const INTERNAL_UPDATE_STATE = Symbol.for('__seqdaUpdateState');
const QUEUE_CHANGE_EVENT    = Symbol.for('__seqdaQueueChangeEvent');
const QUEUE_CHANGE_INFO     = Symbol.for('__seqdaQueueChangeInfo');

function queueChangeEvent(path) {
  let info = this[QUEUE_CHANGE_INFO];
  if (!info.promise) {
    info.promise = Promise.resolve();
    info.promise.then(() => {
      this.emit('update', { store: this, modified: Array.from(Object.keys(info.eventQueue)) });
      info.eventQueue = {};
      info.promise = null;
    });
  }

  if (!info.eventQueue)
    info.eventQueue = {};

  info.eventQueue[path] = true;
}

function clone(value) {
  if (!value)
    return value;

  if (typeof value === 'object') {
    if (Array.isArray(value))
      return value.slice();
    else
      return Object.assign({}, value);
  }

  return value;
}

function getPath(...parts) {
  return parts.filter(Boolean).join('.');
}

function createStoreSubsection(store, sectionTemplate, parent, path, scopeName) {
  const isCacheInvalid = (scopeName, args) => {
    let thisCache = cache[scopeName];
    if (!thisCache)
      return true;

    let cacheArgs = thisCache.args;
    if (cacheArgs.length !== args.length)
      return true;

    for (let i = 0, il = args.length; i < il; i++) {
      if (cacheArgs[i] !== args[i])
        return true;
    }

    if (thisCache.state !== state)
      return true;

    return false;
  };

  const setCache = (scopeName, args, result) => {
    cache[scopeName] = {
      state,
      args,
      result,
    };
  };

  const createScopeMethod = (scopeName, func) => {
    return (...args) => {
      if (isCacheInvalid(scopeName, args)) {
        let result = func({ get, set, store }, ...args);
        setCache(scopeName, args, result);
        return result;
      } else {
        return cache[scopeName].result;
      }
    };
  };

  const copyScopes = (newState, oldState, thisValue, scopeName) => {
    for (let i = 0, il = subScopes.length; i < il; i++) {
      let thisScopeName = subScopes[i];

      Object.defineProperty(newState, thisScopeName, {
        writable:     false,
        enumerable:   true,
        configurable: false,
        value:        (thisScopeName === scopeName) ? thisValue : oldState[thisScopeName],
      });
    }
  };

  const get = (defaultValue) => {
    store.emit('fetchScope', { store, scopeName: path });
    return (state === undefined) ? defaultValue : state;
  };

  const set = (value) => {
    if (value && typeof value === 'object' && value === state)
      throw new Error(`Error: "${getPath(path)}" the state value is the same, but it is required to be different.`);

    if (value === previousState)
      return;

    previousState = state;
    state = value;

    if (Array.isArray(state))
      copyScopes(state, previousState);

    if (typeof state === 'object')
      Object.freeze(state);

    if (parent)
      parent[INTERNAL_UPDATE_STATE](scopeName, state);

    store[QUEUE_CHANGE_EVENT](path, state, previousState);

    return state;
  };

  const updateState = (thisScopeName, newState) => {
    let oldState = state;

    state = clone(state);

    if (Array.isArray(state)) {
      copyScopes(state, oldState, newState, thisScopeName);
    } else {
      Object.defineProperty(state, thisScopeName, {
        writable:     false,
        enumerable:   true,
        configurable: false,
        value:        newState,
      });
    }

    Object.freeze(state);

    if (parent)
      parent[INTERNAL_UPDATE_STATE](scopeName, state);
  };

  const scope   = (!path) ? store : {};
  let keys      = Object.keys(sectionTemplate || {});
  let state     = (path) ? sectionTemplate._ : {};
  let subScopes = [];
  let cache     = {};
  let previousState;

  if (!path) {
    Object.defineProperties(scope, {
      'getState': {
        writable:     false,
        enumberable:  false,
        configurable: false,
        value:        () => state,
      },
      [QUEUE_CHANGE_EVENT]: {
        writable:     false,
        enumberable:  false,
        configurable: false,
        value:        queueChangeEvent.bind(scope),
      },
      [QUEUE_CHANGE_INFO]: {
        writable:     true,
        enumberable:  false,
        configurable: false,
        value:        {},
      },
    });
  }

  Object.defineProperties(scope, {
    [INTERNAL_GET_STATE]: {
      writable:     false,
      enumberable:  false,
      configurable: false,
      value:        () => state,
    },
    [INTERNAL_UPDATE_STATE]: {
      writable:     false,
      enumberable:  false,
      configurable: false,
      value:        updateState,
    },
  });

  if (state && typeof state === 'object')
    Object.freeze(state);

  for (let i = 0, il = keys.length; i < il; i++) {
    let key = keys[i];
    if (key === '_')
      continue;

    let value = sectionTemplate[key];
    if (Nife.instanceOf(value, 'object')) {
      scope[key] = createStoreSubsection(store, value, scope, getPath(path, key), key);
      subScopes.push(key);
      continue;
    }

    if (typeof value !== 'function')
      throw new TypeError(`createStoreSubsection: Value of "${getPath(path, key)}" is invalid. All properties must be functions, or subsections.`);

    scope[key] = createScopeMethod(key, value);
  }

  if (parent && state)
    set(clone(state));

  if (!path)
    return scope;
  else
    return Object.freeze(scope);
}

function createStore(template) {
  if (!Nife.instanceOf(template, 'object'))
    throw new TypeError('createStore: provided "template" must be an object.');

  const store = new EventEmitter();
  return createStoreSubsection(store, template);
}

module.exports = {
  createStore,
};
