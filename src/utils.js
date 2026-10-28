const reservedSegments = new Set(['__proto__', 'constructor', 'prototype'])

export const assertSafePath = path => {
  const keys = Array.isArray(path) ? path : path.split('.')
  for (const key of keys) {
    if (typeof key !== 'string' && typeof key !== 'number') {
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

export const assertSafeObject = value => {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  )
    return
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    const expectedPrototype = Array.isArray(value)
      ? Array.prototype
      : Object.prototype
    const isNullPrototypeObject = prototype === null && !Array.isArray(value)
    if (prototype !== expectedPrototype && !isNullPrototypeObject) {
      throw Error('INVALID object prototype')
    }
  }
  // Inspect nested values too: an entire object or array can be one update.
  for (const key of Object.keys(value)) {
    assertSafePath(key)
    assertSafeObject(value[key])
  }
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
