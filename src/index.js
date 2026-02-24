import Nife from 'nife';
import EventEmitter from 'events';

const QUEUE_CHANGE_EVENT  = Symbol.for('@seqdaQueueChangeEvent');
const QUEUE_CHANGE_INFO   = Symbol.for('@seqdaQueueChangeInfo');
const INTERNAL_STATE      = Symbol.for('@seqdaInternalState');
const UNBOUND_METHOD      = Symbol.for('@seqdaUnboundMethod');
const DISALLOW_WRITE      = Symbol.for('@seqdaDisallowWrite');
const CLEAR_CACHES        = Symbol.for('@seqdaClearCaches');

export function cloneStore(store, readyOnly) {
  const cloneScope = (scope, _newStore) => {
    let keys      = Object.keys(scope);
    let newScope  = (!_newStore) ? new EventEmitter() : {};
    let newStore  = _newStore || newScope;

    if (!_newStore)
      newStore.setMaxListeners(Infinity);

    for (let i = 0, il = keys.length; i < il; i++) {
      let key   = keys[i];
      if (key === '_events' || key === '_eventsCount' || key === '_maxListeners')
        continue;

      let value = scope[key];
      if (typeof value === 'function')
        newScope[key] = storeUnboundMethod(value[UNBOUND_METHOD].bind(newStore), value[UNBOUND_METHOD]);
      else
        newScope[key] = cloneScope(value, newStore);
    }

    return newScope;
  };

  let clonedStore         = cloneScope(store);
  let clonedInternalState = Object.assign({}, store[INTERNAL_STATE]);

  Object.defineProperties(clonedStore, {
    [INTERNAL_STATE]: {
      writable:     (readyOnly !== true) ? true : false,
      enumberable:  false,
      configurable: false,
      value:        (readyOnly !== true) ? clonedInternalState : Object.freeze(clonedInternalState),
    },
  });

  return initializeStore(clonedStore, readyOnly);
}

function queueChangeEvent(path) {
  let info = this[QUEUE_CHANGE_INFO];
  if (!info.promise) {
    info.promise = Promise.resolve();
    info.promise.then(() => {
      let modified      = Array.from(Object.keys(info.eventQueue));
      let previousStore = info.previousStore;

      info.eventQueue = {};
      info.promise = null;
      info.previousStore = cloneStore(this, true);

      this.emit('update', {
        store: this,
        previousStore,
        modified,
      });
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

function storeUnboundMethod(boundMethod, method) {
  Object.defineProperty(boundMethod, UNBOUND_METHOD, {
    writable:     false,
    enumerable:   false,
    configurable: false,
    value:        method,
  });

  return boundMethod;
}

function createStoreSubsection(options, sectionTemplate, path) {
  function isCacheInvalid(scopeName, args) {
    if (this[DISALLOW_WRITE])
      return true;

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
  }

  function setCache(scopeName, args, result) {
    if (this[DISALLOW_WRITE])
      return;

    cache[scopeName] = {
      args,
      result,
    };
  }

  const createScopeMethod = (scopeName, func) => {
    let method = function(...args) {
      if (isCacheInvalid.call(this, scopeName, args)) {
        let result = func({
          get:    getState.bind(this),
          set:    setState.bind(this),
          store:  this,
        }, ...args);

        setCache.call(this, scopeName, args, result);

        return result;
      } else {
        return cache[scopeName].result;
      }
    };

    return storeUnboundMethod(method.bind(this), method);
  };

  function getState() {
    if (options.emitOnFetch === true)
      this.emit('fetchScope', { store: this, scopeName: path });

    let currentState = Nife.get(this[INTERNAL_STATE], path);
    return currentState;
  }

  function setState(value) {
    if (this[DISALLOW_WRITE])
      return;

    let currentState = Nife.get(this[INTERNAL_STATE], path);
    if (value && typeof value === 'object' && value === currentState)
      throw new Error(`Error: "${getPath(path)}" the state value is the same, but it is required to be different.`);

    if (!Nife.propsDiffer(value, currentState))
      return;

    let previousState = currentState;
    this[INTERNAL_STATE] = setPath(this[INTERNAL_STATE], path, value);

    cache = {};

    if (this[QUEUE_CHANGE_EVENT])
      this[QUEUE_CHANGE_EVENT](path, value, previousState);

    return value;
  }

  if (path && !Object.prototype.hasOwnProperty.call(sectionTemplate, '_'))
    throw new Error(`Error: "${getPath}._" default value must be defined.`);

  const scope   = (!path) ? this : {};
  let keys      = Object.keys(sectionTemplate || {});
  let subScopes = [];
  let cache     = {};

  // Register cache-clearing function so hydrate() can invalidate all scopes
  if (this[CLEAR_CACHES])
    this[CLEAR_CACHES].push(() => { cache = {}; });

  if (path)
    setState.call(this, clone(sectionTemplate._));

  for (let i = 0, il = keys.length; i < il; i++) {
    let key = keys[i];
    if (key === '_')
      continue;

    let value = sectionTemplate[key];
    if (Nife.instanceOf(value, 'object')) {
      scope[key] = createStoreSubsection.call(this, options, value, getPath(path, key));
      subScopes.push(key);
      continue;
    }

    if (typeof value !== 'function')
      throw new TypeError(`Error: Value of "${getPath(path, key)}" is invalid. All properties must be functions, or sub scopes.`);

    scope[key] = createScopeMethod(key, value);
  }

  if (!path)
    return this; // We can't freeze the store
  else
    return Object.freeze(scope);
}

function initializeStore(store, readyOnly) {
  Object.defineProperties(store, {
    'getState': {
      writable:     false,
      enumberable:  false,
      configurable: false,
      value:        () => store[INTERNAL_STATE],
    },
  });

  if (readyOnly !== true) {
    Object.defineProperties(store, {
      'hydrate': {
        writable:     false,
        enumberable:  false,
        configurable: false,
        value:        (value) => {
          store[INTERNAL_STATE] = Object.freeze(clone(value));

          // Clear all scope method caches
          let clearFns = store[CLEAR_CACHES];
          for (let i = 0, il = clearFns.length; i < il; i++)
            clearFns[i]();

          queueChangeEvent.call(store, '*');
        },
      },
      [QUEUE_CHANGE_EVENT]: {
        writable:     false,
        enumberable:  false,
        configurable: false,
        value:        queueChangeEvent.bind(store),
      },
      [QUEUE_CHANGE_INFO]: {
        writable:     true,
        enumberable:  false,
        configurable: false,
        value:        {
          previousStore: cloneStore(store, true),
        },
      },
    });
  } else {
    Object.defineProperties(store, {
      [DISALLOW_WRITE]: {
        writable:     false,
        enumberable:  false,
        configurable: false,
        value:        true,
      },
    });
  }

  return store;
}

export function createStore(template, _options) {
  if (!Nife.instanceOf(template, 'object'))
    throw new TypeError('createStore: provided "template" must be an object.');

  const options = _options || {};
  const store = new EventEmitter();

  store.setMaxListeners(Infinity);

  Object.defineProperty(store, INTERNAL_STATE, {
    writable:     true,
    enumerable:   false,
    configurable: false,
    value:        {},
  });

  Object.defineProperty(store, CLEAR_CACHES, {
    writable:     false,
    enumerable:   false,
    configurable: false,
    value:        [],
  });

  let constructedStore = createStoreSubsection.call(store, options, template);
  return initializeStore(constructedStore);
}
