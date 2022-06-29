'use strict';

const Nife          = require('nife');
const EventEmitter  = require('events');

const QUEUE_CHANGE_EVENT  = Symbol.for('__seqdaQueueChangeEvent');
const QUEUE_CHANGE_INFO   = Symbol.for('__seqdaQueueChangeInfo');
const INTERNAL_STATE      = Symbol.for('__seqdaInternalState');

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

function copyKeysToArray(_value, source) {
  let value = _value;

  if (Array.isArray(value) && source) {
    let keys = Object.keys(source);
    for (let i = 0, il = keys.length; i < il; i++) {
      let key = keys[i];
      if ((/^\d+$/).test(key))
        continue;

      value[key] = source[key];
    }
  }

  return value;
}

function clone(value) {
  if (!value)
    return value;

  if (value && typeof value === 'object') {
    if (Array.isArray(value))
      return copyKeysToArray(value.slice(), value);

    return Object.assign({}, value);
  }

  return value;
}

function setPath(_context, path, value) {
  let context   = clone(_context);
  let pathParts = path.split('.');
  let current   = context;

  for (let i = 0, il = pathParts.length; i < il; i++) {
    let pathPart = pathParts[i];

    if ((i + 1) >= il) {
      let finalValue;

      if (Array.isArray(value))
        finalValue = copyKeysToArray(value, current[pathPart]);
      else
        finalValue = value;

      if (finalValue && typeof finalValue === 'object')
        Object.freeze(finalValue);

      current[pathPart] = finalValue;
    } else {
      current[pathPart] = clone(current[pathPart]);
    }

    if (current && typeof current === 'object')
      Object.freeze(current);

    current = current[pathPart];
  }

  return context;
}

function getPath(...parts) {
  return parts.filter(Boolean).join('.');
}

function createStoreSubsection(store, sectionTemplate, path) {
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

    return false;
  };

  const setCache = (scopeName, args, result) => {
    cache[scopeName] = {
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

  const get = () => {
    store.emit('fetchScope', { store, scopeName: path });
    let currentState = Nife.get(store[INTERNAL_STATE], path);
    return currentState;
  };

  const set = (value) => {
    let currentState = Nife.get(store[INTERNAL_STATE], path);
    if (value && typeof value === 'object' && value === currentState)
      throw new Error(`Error: "${getPath(path)}" the state value is the same, but it is required to be different.`);

    let previousState = currentState;
    store[INTERNAL_STATE] = setPath(store[INTERNAL_STATE], path, value);

    cache = {};

    if (store[QUEUE_CHANGE_EVENT])
      store[QUEUE_CHANGE_EVENT](path, value, previousState);

    return value;
  };

  if (path && !Object.prototype.hasOwnProperty.call(sectionTemplate, '_'))
    throw new Error(`Error: "${getPath}._" default value must be defined.`);

  const scope   = (!path) ? store : {};
  let keys      = Object.keys(sectionTemplate || {});
  let subScopes = [];
  let cache     = {};

  if (path)
    set(clone(sectionTemplate._));

  for (let i = 0, il = keys.length; i < il; i++) {
    let key = keys[i];
    if (key === '_')
      continue;

    let value = sectionTemplate[key];
    if (Nife.instanceOf(value, 'object')) {
      scope[key] = createStoreSubsection(store, value, getPath(path, key));
      subScopes.push(key);
      continue;
    }

    if (typeof value !== 'function')
      throw new TypeError(`Error: Value of "${getPath(path, key)}" is invalid. All properties must be functions, or sub scopes.`);

    scope[key] = createScopeMethod(key, value);
  }

  if (!path)
    return scope; // We can't freeze the store
  else
    return Object.freeze(scope);
}

function createStore(template) {
  if (!Nife.instanceOf(template, 'object'))
    throw new TypeError('createStore: provided "template" must be an object.');

  const store = new EventEmitter();

  Object.defineProperty(store, INTERNAL_STATE, {
    writable:     true,
    enumerable:   false,
    configurable: true,
    value:        {},
  });

  let constructedStore = createStoreSubsection(store, template);

  Object.defineProperties(constructedStore, {
    'getState': {
      writable:     false,
      enumberable:  false,
      configurable: false,
      value:        () => constructedStore[INTERNAL_STATE],
    },
    'hydrate': {
      writable:     false,
      enumberable:  false,
      configurable: false,
      value:        (value) => {
        constructedStore[INTERNAL_STATE] = Object.freeze(clone(value));
        queueChangeEvent.call(constructedStore, '*');
      },
    },
    [QUEUE_CHANGE_EVENT]: {
      writable:     false,
      enumberable:  false,
      configurable: false,
      value:        queueChangeEvent.bind(constructedStore),
    },
    [QUEUE_CHANGE_INFO]: {
      writable:     true,
      enumberable:  false,
      configurable: false,
      value:        {},
    },
  });

  return constructedStore;
}

module.exports = {
  createStore,
};
