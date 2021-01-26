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

import { isEmpty } from './utils'
const digitRe = /^\[\d+\]/

export default function (source, keys, update, merge = true) {
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
    if (shouldDelete && isLast) {
      if (Array.isArray(last)) {
        last.splice(currentKey, 1)
      } else {
        delete last[currentKey]
      }
    } else {
      if (isLast) {
        last[currentKey] =
          typeof update === 'object' && !Array.isArray(update) && merge
            ? Object.assign({}, last[currentKey], update)
            : update
      } else {
        last = last[currentKey] = copy(
          last[currentKey],
          typeof keys[i + 1] === 'number'
        )
      }
    }
  }

  // if we are deleting clean out empty
  // objects and arrays
  if (shouldDelete) {
    let last = next,
      i = 0
    for (; i < l; i++) {
      const currentKey = keys[i]
      if (isEmpty(last[currentKey])) {
        delete last[currentKey]
        return next
      }
      last = last[currentKey]
    }
  }

  return next
}

function copy(source, isArr) {
  let to = (source && !!source.pop) || isArr ? [] : {}
  for (let i in source) to[i] = source[i]
  return to
}
