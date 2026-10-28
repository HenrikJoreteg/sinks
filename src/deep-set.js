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
  assertSafeObject,
  assertSafePath,
  getOwnValue,
  isDataContainer,
  isEmpty,
} from './utils.js'
const digitRe = /^\[\d+\]/

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
        if (!Object.hasOwn(obj, i)) continue
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
  // Functions remain opaque values; never descend into their prototype fields.
  if (isDataContainer(source)) {
    for (const key of Object.keys(source)) to[key] = source[key]
  }
  return to
}

// Internal batch setter: callers check all inputs before applying any changes.
export const applyValue = (source, keys, update, merge = true) => {
  keys.split && (keys = keys.split('.'))
  keys = keys.map(key => (digitRe.test(key) ? Number(key.slice(1, -1)) : key))

  let next = copy(source),
    last = next,
    i = 0,
    l = keys.length

  const shouldDelete = update === null

  for (; i < l; i++) {
    const isLast = i === l - 1
    const currentKey = keys[i]
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

export default (source, keys, update, merge = true) => {
  assertSafePath(keys)
  assertSafeObject(source)
  assertSafeObject(update)
  return applyValue(source, keys, update, merge)
}
