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
  assertSafePath,
  getOwnValue,
  hasOwn,
  isDataContainer,
  isEmpty,
} from './utils.js'
const digitRe = /^\[\d+\]$/
// JavaScript array indexes end at 2^32 - 2. The next key (2^32 - 1) is a
// named property instead of an array element, so JSON serialization omits it.
const maxArrayIndex = 2 ** 32 - 2

export const removeNullAndEmpty = original => {
  const removeEmpty = obj => {
    const isObj = typeof obj === 'object'
    const isArray = Array.isArray(obj)

    if (!isObj) {
      return obj
    }

    if (isArray) {
      for (let i = 0, l = obj.length; i < l; i++) {
        // Sparse holes must not expose inherited array entries to cleanup.
        if (!hasOwn(obj, i)) continue
        const value = obj[i]
        if (value === null || isEmpty(value)) {
          obj.splice(i, 1)
          removeEmpty(original)
        } else {
          removeEmpty(value)
        }
      }
    } else {
      for (const key of Object.keys(obj || {})) {
        const value = obj[key]
        if (value === null || isEmpty(value)) {
          delete obj[key]
          removeEmpty(original)
        } else {
          removeEmpty(value)
        }
      }
    }

    return obj
  }

  return removeEmpty(original)
}

const copy = (source, isArr) => {
  const to = Array.isArray(source) || isArr ? [] : {}
  // An object converted to an array must not carry over named properties.
  if (isDataContainer(source) && (Array.isArray(source) || !isArr)) {
    for (const key of Object.keys(source)) to[key] = source[key]
  }
  return to
}

// Internal batch setter: callers check all inputs before applying any changes.
export const applyValue = (source, keys, update, merge = true) => {
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
          const previous = isDataContainer(currentValue)
            ? currentValue
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

  return removeNullAndEmpty(next)
}

export default (source = {}, keys, update, merge = true) => {
  assertSafePath(keys)
  assertJsonData(source)
  assertJsonData(update)
  return applyValue(source, keys, update, merge)
}
