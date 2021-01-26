const str = val => typeof val === 'string'
const bool = val => typeof val === 'boolean'
const num = val => typeof val === 'number'
const int = val => num(val) && Math.round(val) === val
const positiveInt = val => int(val) && val >= 0
const matches = values => val => values.includes(val)
const timestamp = val => !isNaN(new Date(val).valueOf())
const arr = Array.isArray
const obj = val => typeof val === 'object'
const func = val => typeof val === 'function'

export const basicTypes = {
  str,
  bool,
  num,
  int,
  positiveInt,
  matches,
  timestamp,
  arr,
  obj,
  func,
}
