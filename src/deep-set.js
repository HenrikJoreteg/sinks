// Modified version of clean-set (https://github.com/fwilkerson/clean-set)
// License included below
/*
MIT License

Copyright (c) 2018 Frank Wilkerson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import {
  assertJsonData,
  assertSafeContainer,
  assertSafePath,
  getDataKeys,
  getOwnValue,
  isDataContainer,
  isEmpty,
} from './utils.js'
const digitRe = /^\[\d+\]$/
// JavaScript array indexes end at 2^32 - 2. The next key (2^32 - 1) is a
// named property instead of an array element, so JSON serialization omits it.
const maxArrayIndex = 2 ** 32 - 2

export const removeNullAndEmpty = (original, cleanedValues = new WeakMap()) => {
  const removeEmpty = value => {
    if (value === null || typeof value !== 'object') return value
    if (cleanedValues.has(value)) {
      const cleaned = cleanedValues.get(value)
      if (cleaned === null) throw Error('INVALID circular reference')
      return cleaned
    }
    const keys = getDataKeys(value)
    // Null marks an ancestor being visited; completed entries preserve aliases.
    cleanedValues.set(value, null)
    const isArray = Array.isArray(value)
    let result = value
    let nextIndex = 0
    for (const key of keys) {
      const current = getOwnValue(value, key)
      const cleaned = removeEmpty(current)
      const shouldRemove = cleaned === null || isEmpty(cleaned)
      if (
        shouldRemove ||
        cleaned !== current ||
        (isArray && nextIndex !== Number(key))
      ) {
        if (result === value) {
          const container = isArray
            ? []
            : Object.create(Object.getPrototypeOf(value))
          result = copyOwnFields(value, container)
        }
      }
      if (shouldRemove) {
        if (!isArray) delete result[key]
      } else {
        if (result !== value) result[isArray ? nextIndex : key] = cleaned
        nextIndex++
      }
    }
    if (isArray && result !== value) result.length = nextIndex
    cleanedValues.set(value, result)
    // Immutable results can be reused by later edits in the same batch.
    if (result !== value) cleanedValues.set(result, result)
    return result
  }
  return removeEmpty(original)
}

const copyOwnFields = (source, target) => {
  for (const key of getDataKeys(source)) target[key] = getOwnValue(source, key)
  return target
}

const copy = (source, isArr) => {
  assertSafeContainer(source)
  const to = Array.isArray(source) || isArr ? [] : {}
  // An object converted to an array must not carry over named properties.
  if (isDataContainer(source) && (Array.isArray(source) || !isArr)) {
    copyOwnFields(source, to)
  }
  return to
}

// Internal batch setter: callers check all inputs before applying any changes.
export const applyValue = (
  source,
  keys,
  update,
  merge = true,
  cleanedValues
) => {
  if (typeof keys === 'string') keys = keys.split('.')
  keys = Array.prototype.map.call(keys, key =>
    digitRe.test(key) ? Number(key.slice(1, -1)) : key
  )

  let next = copy(source),
    last = next,
    i = 0,
    l = keys.length

  const shouldDelete = update === null

  for (; i < l; i++) {
    const isLast = i === l - 1
    const currentKey = keys[i]
    if (Array.isArray(last)) {
      // Dotted paths supply string keys; convert them for the numeric checks.
      const index = Number(currentKey)
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index > maxArrayIndex ||
        // "01", "1e0", and "" coerce to integers but are named properties.
        String(index) !== String(currentKey)
      ) {
        throw Error('INVALID array index')
      }
      // Below length replaces an item; at length appends. Beyond length leaves
      // holes. Deleting a missing final entry is a no-op, so it is allowed.
      if (index > last.length && !(shouldDelete && isLast)) {
        throw Error('INVALID array: cannot skip indexes')
      }
    }
    const currentValue = getOwnValue(last, currentKey)
    if (shouldDelete && isLast) {
      if (Array.isArray(last)) {
        last.splice(currentKey, 1)
      } else {
        delete last[currentKey]
      }
    } else {
      if (isLast) {
        let nextValue = update
        if (isDataContainer(update) && !Array.isArray(update) && merge) {
          // An existing leaf has not been recursively validated. Copy it through
          // the same own-key guards as every other container before merging.
          if (currentValue !== null && typeof currentValue === 'object') {
            assertSafeContainer(currentValue)
          }
          const previous = isDataContainer(currentValue)
            ? copy(currentValue)
            : undefined
          nextValue = Object.assign({}, previous, update)
        }
        last[currentKey] = nextValue
      } else {
        last = last[currentKey] = copy(
          currentValue,
          typeof keys[i + 1] === 'number'
        )
      }
    }
  }

  return removeNullAndEmpty(next, cleanedValues)
}

export default (source = {}, keys, update, merge = true) => {
  assertSafePath(keys)
  assertSafeContainer(source)
  assertJsonData(update)
  return applyValue(source, keys, update, merge)
}
