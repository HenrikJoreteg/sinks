//@ts-check
import deepSet from './deep-set'
import { basicTypes } from './basic-types'
import { injectBrackets, isEmpty, stripBrackets } from './utils'
import dlv from 'dlv'

const toRegexp = str =>
  new RegExp(
    '^' +
      str
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
  const processedByLength = {}
  for (const key in definition) {
    const value = definition[key]
    if (key.includes('{}') || key.includes('[]')) {
      const split = key.split('.')
      const keysBeforeVariable = []
      const length = split.length
      if (!processedByLength[length]) {
        processedByLength[length] = {}
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
    if (definition[path]) {
      return definition[path]
    }
    const length = path.split('.').length
    const processed = processedByLength[length]
    for (const key in processed) {
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

/**
 * @param {any} original The original object
 * @param {any} modified The modified one
 * @param {{
 *   includeDeletions?: boolean
 *   ignoredKeys?: string[]
 * }} [options]
 * @returns {any} Changes object or null
 */
export const getChanges = (
  original,
  modified,
  { includeDeletions = true, ignoredKeys } = {}
) => {
  const combined = { ...original, ...modified }
  const changes = {}
  for (const key in combined) {
    if (ignoredKeys && ignoredKeys.includes(key)) {
      continue
    }
    const inOriginal = original && original.hasOwnProperty(key)
    const inModified = modified && modified.hasOwnProperty(key)
    // removed in new
    if (inOriginal && !inModified) {
      if (includeDeletions) {
        changes[key] = null
      }
      continue
    }

    // what type of value are we dealing with?
    const modifiedValue = modified[key]
    const modifiedValueIsObject = typeof modifiedValue === 'object'

    // checks if modified value is different in any way
    if (!inOriginal || modifiedValue !== original[key]) {
      if (modifiedValueIsObject && modifiedValue !== null) {
        // we pass through "ignored" for nested stuff, but not the ignored keys
        // those only apply at the top level
        const otherChanges = getChanges(
          inOriginal ? original[key] : {},
          modifiedValue,
          {
            includeDeletions,
          }
        )
        for (const otherKey in otherChanges) {
          const value = otherChanges[otherKey]
          const isArray = Array.isArray(modified[key])
          changes[
            key + '.' + (isArray ? injectBrackets(otherKey) : otherKey)
          ] = value
        }
      } else {
        changes[key] = modifiedValue
      }
    }
  }
  return Object.keys(changes).length ? changes : null
}

export const setValue = deepSet

export const updateObject = (obj, updateObj) => {
  let updated = obj
  for (const key in updateObj) {
    updated = setValue(updated, key, updateObj[key], false)
  }
  return updated
}

export const mergeObjects = (obj1, obj2) => {
  const addedByObj2 = getChanges(obj1, obj2, { includeDeletions: false })
  const addedByObj1 = getChanges(obj2, obj1, { includeDeletions: false })

  if (!addedByObj1 && !addedByObj2) {
    return { updated: obj1 }
  }
  if (!addedByObj1) {
    return { updated: updateObject(obj1, addedByObj2) }
  }
  if (!addedByObj2) {
    return { updated: updateObject(obj2, addedByObj1) }
  }

  // both made additions, there may be conflicts
  // look for keys that are the same
  const conflicts = {}
  const notConflicted = {}
  for (const key in addedByObj2) {
    if (addedByObj1.hasOwnProperty(key)) {
      const cleanedKey = stripBrackets(key)
      conflicts[key] = [dlv(obj1, cleanedKey), dlv(obj2, cleanedKey)]
    } else {
      notConflicted[key] = addedByObj2[key]
    }
  }
  for (const key in addedByObj1) {
    if (!addedByObj2.hasOwnProperty(key)) {
      notConflicted[key] = addedByObj1[key]
    }
  }
  const toReturn = { updated: updateObject(obj1, notConflicted) }
  if (!isEmpty(conflicts)) {
    toReturn.conflicts = conflicts
  }
  return toReturn
}

export const buildDefinition = (definition, fnsObject = basicTypes) => {
  const matcher = buildMatcherFunction(definition)

  const validateObject = (obj, path = '') => {
    for (const key in obj) {
      const value = obj[key]
      if (value === null) {
        continue
      }
      const extendedPath = path ? path + '.' + key : key
      const type = matcher(extendedPath)

      if (typeof value === 'object' && type !== 'obj') {
        if (isEmpty(value) && !type) {
          throw Error('INVALID path: ' + extendedPath)
        }
        validateObject(value, extendedPath)
      } else {
        if (!type) {
          throw Error('INVALID path: ' + extendedPath)
        }
        let testFn
        if (Array.isArray(type)) {
          let found = false
          let passed = false
          for (const typeEntry of type) {
            if (fnsObject[typeEntry]) {
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
          testFn = fnsObject[type]
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

  const setValue = (obj, path, value, validate = true) => {
    const updated = deepSet(obj, path, value)
    if (validate) {
      validateObject(updated)
    }
    return updated
  }

  const update = (obj, updateObj, validate = true) => {
    let updated = obj
    for (const key in updateObj) {
      updated = setValue(updated, key, updateObj[key], false)
    }
    if (validate) {
      validateObject(updated)
    }
    return updated
  }

  const merge = (obj1, obj2, validate = true) => {
    const result = mergeObjects(obj1, obj2)
    if (validate) {
      validateObject(result.updated)
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
