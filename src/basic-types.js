const str = val => typeof val === 'string'
const bool = val => typeof val === 'boolean'
const num = Number.isFinite
const int = Number.isInteger
const positiveInt = val => int(val) && val >= 0
const matches = values => val => values.includes(val)
const timestamp = val => positiveInt(val) && val > 0 && val < 7258147200000 // this is year 2200
const arr = Array.isArray
const obj = val => typeof val === 'object'

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
}
