const reservedSegments = new Set(['__proto__'])

export const isDataContainer = value => {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value)) return prototype === Array.prototype
  return prototype === null || prototype === Object.prototype
}

export const assertSafePath = path => {
  if (typeof path !== 'string' && !Array.isArray(path)) {
    throw Error('INVALID path')
  }
  if (Array.isArray(path)) assertJsonData(path)
  const keys = typeof path === 'string' ? path.split('.') : path
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]
    if (typeof key !== 'string' && typeof key !== 'number') {
      throw Error('INVALID path segment')
    }
    if (typeof key === 'number' && !Number.isFinite(key)) {
      throw Error('INVALID path segment')
    }
    if (
      String(key)
        .split('.')
        .some(segment => reservedSegments.has(segment))
    ) {
      throw Error('INVALID reserved path segment')
    }
  }
}

export const assertJsonData = value => {
  const ancestors = new WeakSet()
  const checked = new WeakSet()

  const check = (value, path = '') => {
    if (value === null) return
    const type = typeof value
    if (type === 'string' || type === 'boolean') return
    if (type === 'number' && Number.isFinite(value)) return
    if (type !== 'object') {
      const kind = type === 'number' ? 'non-finite number' : type
      throw Error(
        `INVALID ${path || 'JSON data'}: ${kind} is not JSON-compatible`
      )
    }
    if (!isDataContainer(value)) {
      throw Error('INVALID object prototype')
    }
    if (ancestors.has(value)) {
      throw Error('INVALID circular reference')
    }
    // Shared references are valid; only references to an ancestor are cycles.
    if (checked.has(value)) return
    ancestors.add(value)

    const keys = Object.keys(value)
    const isArray = Array.isArray(value)
    if (isArray && keys.length !== value.length) {
      throw Error('INVALID array: expected dense indexed data')
    }
    for (const symbol of Object.getOwnPropertySymbols(value)) {
      if (Object.prototype.propertyIsEnumerable.call(value, symbol)) {
        throw Error('INVALID JSON data: symbol key')
      }
    }
    // JSON.stringify invokes toJSON even when it is non-enumerable.
    const toJSON = Object.getOwnPropertyDescriptor(value, 'toJSON')
    if (
      toJSON &&
      (!Object.hasOwn(toJSON, 'value') || typeof toJSON.value === 'function')
    ) {
      throw Error('INVALID JSON data: custom serialization')
    }
    for (const key of keys) {
      assertSafePath(key)
      if (
        isArray &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      ) {
        throw Error('INVALID array: expected dense indexed data')
      }
      const property = Object.getOwnPropertyDescriptor(value, key)
      // Reject executable properties instead of invoking getters during checks.
      if (!Object.hasOwn(property, 'value')) {
        throw Error('INVALID JSON data: accessor property')
      }
      check(property.value, path ? path + '.' + key : key)
    }
    ancestors.delete(value)
    checked.add(value)
  }

  check(value)
}

export const getOwnValue = (object, key) => {
  if (object != null && Object.hasOwn(object, key)) return object[key]
}

export const isEmpty = unknown => {
  if (typeof unknown === 'object') {
    // handle null which is "object"
    if (!unknown) {
      return true
    }
    if (Array.isArray(unknown) && !unknown.length) {
      return true
    }
    return !Object.keys(unknown).length
  }
  return false
}

export const stripBrackets = str => str.replace(/[[\]]/g, '')

export const injectBrackets = str => {
  if (!str) return str
  const split = str.split('.')
  return [`[${split[0]}]`, ...split.slice(1)].join('.')
}

/**
 * As simple object deep equal that makes the following assumptions:
 *
 * - No circular references
 * - No functions
 * - No complex objects like Date, Map, Set, etc. keysToIgnore is an optional
 *   array of keys top level keys to ignore for the comparison. This allows
 *   comparisons to ignore large objects without having to copy and remove keys
 *
 * @param {any} a First object
 * @param {any} b Second object
 * @param {string[]} [keysToIgnore] Optional array of top-level keys to ignore
 * @returns
 */
export const simpleObjectDeepEqual = (a, b, keysToIgnore = []) => {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  const keysA = Object.keys(a).filter(key => !keysToIgnore.includes(key))
  const keysB = Object.keys(b).filter(key => !keysToIgnore.includes(key))
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!keysB.includes(key)) return false
    if (!simpleObjectDeepEqual(a[key], b[key])) return false
  }
  return true
}
