//@ts-check
import deepSet, { applyValue, removeNullAndEmpty } from './deep-set.js'
import { basicTypes } from './basic-types.js'
import {
  assertJsonData,
  assertSafeContainer,
  getDataKeys,
  getOwnValue,
  hasOwn,
  injectBrackets,
  isDataContainer,
  isEmpty,
  stripBrackets,
} from './utils.js'

const getPathValue = (object, path) => {
  for (const key of path.split('.')) {
    if (!isDataContainer(object)) return
    object = getOwnValue(object, key)
  }
  return object
}

const toRegexp = str =>
  new RegExp(
    '^' +
      str
        // Convert definition wildcards into one-segment path matchers.
        .replace(/\./g, '\\.')
        .replace(/\{\}/g, '[^.]+')
        .replace(/\[\]/g, '\\d+') +
      '$'
  )

const buildMatcherFunction = definition => {
  /**
   * We first categorize them by length then by what the key starts with to be
   * able to limit the number of items it has to test for each key.
   */
  const processedByLength = Object.create(null)
  for (const key of Object.keys(definition)) {
    const value = definition[key]
    if (key.includes('{}') || key.includes('[]')) {
      const split = key.split('.')
      const keysBeforeVariable = []
      const length = split.length
      if (!processedByLength[length]) {
        processedByLength[length] = Object.create(null)
      }
      const processed = processedByLength[length]
      for (const part of split) {
        if (part === '{}' || part === '[]') {
          break
        }
        keysBeforeVariable.push(part)
      }
      const startsWith = keysBeforeVariable.join('.') + '.'
      if (!processed[startsWith]) {
        processed[startsWith] = []
      }
      const regex = toRegexp(key)
      processed[startsWith].push({
        value,
        test: regex.test.bind(regex),
      })
    }
  }

  return path => {
    if (hasOwn(definition, path)) {
      return definition[path]
    }
    const length = path.split('.').length
    const processed = processedByLength[length]
    for (const key of Object.keys(processed || {})) {
      if (path.startsWith(key)) {
        const limitedItemsToTest = processed[key]
        for (const { test, value } of limitedItemsToTest) {
          if (test(path)) {
            return value
          }
        }
      }
    }
  }
}

const isNullTombstone = value => {
  if (value === null) {
    return true
  }
  if (typeof value !== 'object') {
    return false
  }
  return Object.keys(value).every(key =>
    isNullTombstone(getOwnValue(value, key))
  )
}

/**
 * @param {any} original The original object
 * @param {any} modified The modified one
 * @param {{
 *   includeDeletions?: boolean
 *   ignoredKeys?: string[]
 * }} [options]
 * @returns {any} Changes object or null
 */
const getObjectChanges = (
  original,
  modified,
  { includeDeletions = true, ignoredKeys } = {}
) => {
  // Only visit compared branches. Unchanged state is expected to have already
  // been validated; own-key guards still protect every generated update path.
  const combined = Object.create(null)
  for (const key of getDataKeys(original)) combined[key] = true
  for (const key of getDataKeys(modified)) combined[key] = true
  const changes = {}
  for (const key of Object.keys(combined)) {
    if (ignoredKeys && ignoredKeys.includes(key)) {
      continue
    }
    const inOriginal = original && hasOwn(original, key)
    const inModified = modified && hasOwn(modified, key)
    // removed in new
    if (inOriginal && !inModified) {
      if (includeDeletions && !isNullTombstone(getOwnValue(original, key))) {
        changes[key] = null
      }
      continue
    }

    // what type of value are we dealing with?
    const originalValue = getOwnValue(original, key)
    let modifiedValue = getOwnValue(modified, key)
    const modifiedValueIsObject = typeof modifiedValue === 'object'

    // checks if modified value is different in any way
    if (!inOriginal || modifiedValue !== originalValue) {
      if (modifiedValueIsObject) assertSafeContainer(modifiedValue)
      if (isNullTombstone(modifiedValue)) {
        if (!inOriginal || isNullTombstone(originalValue)) continue
        // Empty containers replace a scalar just like a null tombstone. There
        // are no original child properties to express as individual deletions.
        if (!isDataContainer(originalValue)) {
          changes[key] = null
          continue
        }
      }
      if (Array.isArray(modifiedValue)) {
        const originalIsArray = inOriginal && Array.isArray(originalValue)
        const originalLength = originalIsArray ? originalValue.length : 0
        const newIndexes = Object.keys(modifiedValue).slice(originalLength)
        if (
          newIndexes.some(index =>
            isNullTombstone(getOwnValue(modifiedValue, index))
          )
        ) {
          const incoming = newIndexes.map(index =>
            getOwnValue(modifiedValue, index)
          )
          assertJsonData(incoming)
          const additions = removeNullAndEmpty(incoming)
          if (!originalIsArray) {
            // Skipping a tombstone in a new array would leave a gap in its
            // generated paths. Set the cleaned array as one complete value.
            changes[key] = additions
            continue
          }
          // Existing indexes keep their deletion semantics. Only compact the
          // appended portion, where tombstones have no original item to delete.
          const existing = Object.keys(modifiedValue)
            .slice(0, originalLength)
            .map(index => getOwnValue(modifiedValue, index))
          modifiedValue = existing.concat(additions)
        }
      }
      if (modifiedValueIsObject && modifiedValue !== null) {
        // we pass through "ignored" for nested stuff, but not the ignored keys
        // those only apply at the top level
        const otherChanges = getObjectChanges(
          inOriginal && isDataContainer(originalValue) ? originalValue : {},
          modifiedValue,
          {
            includeDeletions,
          }
        )
        for (const otherKey of Object.keys(otherChanges || {})) {
          const value = otherChanges[otherKey]
          const isArray = Array.isArray(modifiedValue)
          changes[
            key + '.' + (isArray ? injectBrackets(otherKey) : otherKey)
          ] = value
        }
      } else {
        assertJsonData(modifiedValue)
        changes[key] = modifiedValue
      }
    }
  }
  return Object.keys(changes).length ? changes : null
}

/**
 * @param {any} original The original object
 * @param {any} modified The modified one
 * @param {{ includeDeletions?: boolean; ignoredKeys?: string[] }} [options]
 * @returns {any} Changes object or null
 */
export const getChanges = (original = {}, modified = {}, options = {}) => {
  return getObjectChanges(original, modified, options)
}

export const setValue = deepSet

const getUpdateKeys = updateObj => {
  const keys = []
  const arrayDeletions = []
  for (const key of Object.keys(updateObj || {})) {
    if (isNullTombstone(updateObj[key]) && /\[\d+\]/.test(key)) {
      arrayDeletions.push(key)
    } else {
      keys.push(key)
    }
  }
  // Apply writes before splicing, then delete highest indexes first. Nested
  // deletions and empty values also need this order because cleanup can splice.
  arrayDeletions.sort((first, second) =>
    second.localeCompare(first, 'en', { numeric: true })
  )
  return [...keys, ...arrayDeletions]
}

const applyCheckedUpdates = (obj, updateObj, merge) => {
  let updated = obj
  // Cleanup is immutable, so unchanged branches need only be visited once.
  const cleanedValues = new WeakMap()
  for (const key of getUpdateKeys(updateObj)) {
    updated = applyValue(
      updated,
      key,
      getOwnValue(updateObj, key),
      merge,
      cleanedValues
    )
  }
  return updated
}

const applyUpdates = (obj = {}, updateObj = {}, merge) => {
  assertSafeContainer(obj)
  // Reject the entire incoming batch before editing. Existing state is checked
  // locally when containers are copied, traversed, or cleaned.
  assertJsonData(updateObj)
  return applyCheckedUpdates(obj, updateObj, merge)
}

export const updateObject = (obj, updateObj) =>
  applyUpdates(obj, updateObj, false)

export const mergeObjects = (obj1 = {}, obj2 = {}) => {
  const addedByObj2 = getObjectChanges(obj1, obj2, { includeDeletions: false })
  const addedByObj1 = getObjectChanges(obj2, obj1, { includeDeletions: false })

  if (!addedByObj1 && !addedByObj2) {
    return { updated: obj1 }
  }
  if (!addedByObj1) {
    return { updated: applyCheckedUpdates(obj1, addedByObj2, false) }
  }
  if (!addedByObj2) {
    return { updated: applyCheckedUpdates(obj2, addedByObj1, false) }
  }

  // both made additions, there may be conflicts
  // look for keys that are the same
  const conflicts = {}
  const notConflicted = {}
  for (const key of Object.keys(addedByObj2)) {
    if (hasOwn(addedByObj1, key)) {
      const cleanedKey = stripBrackets(key)
      conflicts[key] = [
        getPathValue(obj1, cleanedKey),
        getPathValue(obj2, cleanedKey),
      ]
    } else {
      notConflicted[key] = addedByObj2[key]
    }
  }
  for (const key of Object.keys(addedByObj1)) {
    if (!hasOwn(addedByObj2, key)) {
      notConflicted[key] = addedByObj1[key]
    }
  }
  const toReturn = { updated: applyCheckedUpdates(obj1, notConflicted, false) }
  if (!isEmpty(conflicts)) {
    toReturn.conflicts = conflicts
  }
  return toReturn
}

export const buildDefinition = (definition, fnsObject = basicTypes) => {
  assertJsonData(definition)
  const matcher = buildMatcherFunction(definition)

  const validateValues = (obj, path = '') => {
    for (const key of getDataKeys(obj)) {
      const value = getOwnValue(obj, key)
      if (value === null) {
        continue
      }
      const extendedPath = path ? path + '.' + key : key
      const type = matcher(extendedPath)

      if (typeof value === 'object' && type !== 'obj') {
        if (isEmpty(value) && !type) {
          throw Error('INVALID path: ' + extendedPath)
        }
        validateValues(value, extendedPath)
      } else {
        if (!type) {
          throw Error('INVALID path: ' + extendedPath)
        }
        let testFn
        if (Array.isArray(type)) {
          let found = false
          let passed = false
          for (const typeEntry of type) {
            if (hasOwn(fnsObject, typeEntry)) {
              found = true
              if (fnsObject[typeEntry](value)) {
                passed = true
                break
              }
            }
          }
          if (!passed || !found) {
            throw Error(`INVALID ${extendedPath}: ${value}`)
          }
          return
        } else {
          testFn = hasOwn(fnsObject, type) ? fnsObject[type] : undefined
        }
        if (!testFn) {
          throw Error('INVALID type: ' + type)
        }
        if (!testFn(value)) {
          throw Error(`INVALID ${extendedPath}: ${value}`)
        }
      }
    }
  }

  const validateObject = (obj = {}, path = '') => {
    assertJsonData(obj)
    validateValues(obj, path)
  }

  const setValue = (obj, path, value, validate = true) => {
    const updated = deepSet(obj, path, value)
    if (validate) {
      validateValues(updated)
    }
    return updated
  }

  const update = (obj, updateObj, validate = true) => {
    const updated = applyUpdates(obj, updateObj, true)
    if (validate) {
      validateValues(updated)
    }
    return updated
  }

  const merge = (obj1, obj2, validate = true) => {
    const result = mergeObjects(obj1, obj2)
    if (validate) {
      validateValues(result.updated)
    }
    return result
  }

  return {
    validate: validateObject,
    setValue,
    update,
    merge,
  }
}
