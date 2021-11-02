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

export const isInt = str => /^\d+$/.test(str)

export const stripBrackets = str => str.replace(/[[\]]/g, '')
