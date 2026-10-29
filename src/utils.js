const hasOwnProperty = Object.prototype.hasOwnProperty
const propertyIsEnumerable = Object.prototype.propertyIsEnumerable
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype'])

export const assertAllowedKey = key => {
  if (forbiddenKeys.has(key)) throw Error('Forbidden key: ' + key)
}

// Inspect incoming values before cleanup can mutate them. Existing documents
// need no additional traversal for scalar updates. Functions remain opaque.
export const assertAllowedKeys = value => {
  if (value === null || typeof value !== 'object') return
  for (const key of Object.keys(value)) {
    assertAllowedKey(key)
    assertAllowedKeys(value[key])
  }
}

// Use the built-in method, including on runtimes without Object.hasOwn.
export const hasOwn = (object, key) => hasOwnProperty.call(object, key)

export const getOwnValue = (object, key) =>
  object != null && hasOwn(object, key) ? object[key] : undefined

// Assignment to __proto__ invokes an inherited setter. Define an own data
// property instead, so all keys remain literal data and cannot change prototypes.
export const setOwnValue = (object, key, value) => {
  if (hasOwn(object, key)) {
    // Preserve existing descriptors, notably an array's non-configurable length.
    Object.defineProperty(object, key, { value })
    return
  }
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
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
    // Match Object.keys semantics without scanning the second key list each time.
    if (!propertyIsEnumerable.call(b, key)) return false
    if (!simpleObjectDeepEqual(a[key], b[key])) return false
  }
  return true
}
