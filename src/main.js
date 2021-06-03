//@ts-check
import deepSet from './deep-set'
import { basicTypes } from './basic-types'
import { isEmpty } from './utils'
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
  const processed = {}
  for (const key in definition) {
    processed[key] = { regex: toRegexp(key), key }
  }

  return path => {
    for (const key in processed) {
      const matches = processed[key].regex.test(path)
      if (matches) {
        return definition[key]
      }
    }
  }
}

/**
 *
 * @param {any} original the original object
 * @param {any} modified the modified one
 * @param {{
 *  includeDeletions?: boolean,
 *  ignoredKeys?: string[]
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
      // added in new
    } else if (inModified && !inOriginal) {
      changes[key] = modified[key]
      // changed in new
    } else if (modified[key] !== original[key]) {
      const modifiedType = typeof modified[key]
      if (modifiedType === 'object') {
        // we pass through "ignored" for nested stuff, but not the ignored keys
        // those only apply at the top level
        const otherChanges = getChanges(original[key], modified[key], {
          includeDeletions,
        })
        for (const otherKey in otherChanges) {
          changes[key + '.' + otherKey] = otherChanges[otherKey]
        }
      } else {
        changes[key] = modified[key]
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
      conflicts[key] = [dlv(obj1, key), dlv(obj2, key)]
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
          throw Error('Invalid path: ' + extendedPath)
        }
        validateObject(value, extendedPath)
      } else {
        if (!type) {
          throw Error('Invalid path: ' + extendedPath)
        }
        let testFn
        if (Array.isArray(type)) {
          testFn = () => type.some(typeEntry => fnsObject[typeEntry])
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
