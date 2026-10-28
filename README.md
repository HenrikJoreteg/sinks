# sinks

![](https://img.shields.io/npm/dm/sinks.svg)![](https://img.shields.io/npm/v/sinks.svg)![](https://img.shields.io/npm/l/sinks.svg)

A set of simple utilities for defining, validating, updating, diffing, and ultimately syncing (get it?!) state stored as JSON-compatible objects and arrays.

Small enough for use in client-side code. In fact, it's very handy if you're looking for a way to enforce more structure in redux reducers.

Enables validation (optional), deep immutable setting of values, and efficient diffing.

Sinks 5.0.0 enforces a [JSON-compatible data contract](#json-compatible-data-500).
Validate loaded state explicitly; incoming edits are always checked, even when
schema validation is disabled.

## What does it do?

It was designed to be part of a system where data stored as simple objects needs to be synchronized between servers and clients yet allow for disconnected changes and caching state locally then synchronizing it again when reconnected.

## Basic use cases

1. You have a large object and a modified version of that large object, you want them to be the same, but you don't want to send the entire new object.

2. Defining/validating/updating objects stored in redux reducers. Updates are always immutable!

3. You want to define, at a high-level, a simple object shape where all values are optional but any values have to match defined shape and types.

4. You want to try merging two object not knowing if they have conflicting changes or not. Giving you the information about what properties are in conflict.

## Main exports

Sinks is published as plain ESM source. Use ESM imports:

```js
import { buildDefinition, getChanges, updateObject } from 'sinks'
```

CommonJS `require('sinks')` is no longer supported.

### `getChanges(originalObject, finalState, {includeDeletions: true, ignoredKeys: []})`

This will return an object containing changes that can be applied to another object using `updateObject()`. If there are no changes, returns `null`.

It takes an optional options object where you can opt out of including deletions and you can specify a list of top-level object keys to ignore.

Because `null` is the deletion marker used by `updateObject()`, `getChanges()` treats explicit `null` tombstones and already-missing values as equivalent. It still reports `null` when an existing non-null value is deleted.

New arrays containing `null` or recursively empty entries are emitted as a
cleaned whole-array value. This keeps the generated update dense and directly
applicable:

```js
const changes = getChanges({}, { items: [null, 'new'] })
// { items: ['new'] }
updateObject({}, changes)
// { items: ['new'] }
```

Edits to existing arrays remain granular. Existing indexes still identify the
original entries for writes and deletions; null/empty entries in the appended
portion do not reserve new slots. Diff generation does not mutate the supplied
arrays while normalizing these additions.

### `updateObject(currentObject, changes)`

This returns an updated object with changes applied. These changes need to be structured as an object of paths to update.

Example of updating a nested item:

```js
const obj1 = {
  name: 'Henrik',
}

const updatedObject = updateObject(obj1, {
  'favoriteColors.foo.name': 'yellow',
})

console.log(updatedObject)
// {
//   name: 'Henrik',
//   favoriteColors: {
//     foo: {
//       name: 'yellow',
//     },
//   },
// }
```

Example of deleting a value:

```js
const obj1 = {
  name: 'Henrik',
  something: {
    foo: 'cool',
  },
}

// setting a value to `null` deletes it
const updatedObject = updateObject(obj1, {
  'something.foo': null,
})

// Note: empty objects are removed
console.log(updatedObject)
// {
//   name: 'Henrik',
// }
```

Example of updating item in an array

```js
const obj1 = {
  name: 'Henrik',
  myStuff: [{ id: 'thing', description: 'pizza' }],
}

// if an array already exists in the first object
// you can just provide an update that uses the
// index as a number in your update path:
const updated = updateObject(obj1, {
  'myStuff.0.description': 'skis',
})

console.log(updated)
// {
//   name: 'Henrik',
//   myStuff: [{ id: 'thing', description: 'skis' }],
// }
```

Updating by array index doesn't work if the array doesn't exist in the object. But we can explicitly specify that an item in an array is an index by putting square brackets around it:

```js
// note that missing things are created
// but we can't know whether to create an
// array or an object unless you tell it with `[]`
const obj1 = {
  name: 'Henrik',
}

// The square brackets tells the updater to create an array
// instead of an object with a key named '0'
const updated = updateObject(obj1, {
  'myStuff.[0].description': 'skis',
})

console.log(updated)
// {
//   name: 'Henrik',
//   myStuff: [{ id: 'thing', description: 'skis' }],
// }

// if you *DON'T* supply the brackets this would happen
console.log(
  updateObject(obj1, {
    'myStuff.0.description': 'skis',
  })
)
// {
//   name: 'Henrik',
//   myStuff: {
//     0: {
//       description: 'skis',
//     },
//   },
// }
```

You don't have to supply a whole path if you want to set an object:

```js
const obj1 = {
  name: 'Henrik',
}

// can just supply an object
console.log(
  updateObject(obj1, {
    other: {
      nested: 'thing',
    },
  })
)
// {
//   name: 'Henrik',
//   other: {
//     nested: 'thing'
//   }
// }
```

Empty objects and arrays and `null` values are automatically removed.

```js
const obj1 = {
  name: 'Henrik',
}

// even if you set a deeply nested set of
// objects and the very last value is empty
// the whole chain of empty stuff is removed
console.log(
  updateObject(obj1, {
    other: {
      nested: {
        // note final value is an empty array
        // once this is removed, the parent ones
        // will be empty. So the whole thing is
        // removed.
        hi: [],
      },
    },
  })
)
// {
//   name: 'Henrik',
// }
```

### JSON-compatible data (5.0.0)

Sinks works with data that can be stored and synchronized as JSON. Supported
values are strings, finite numbers, booleans, `null`, plain objects,
null-prototype objects, and dense arrays containing supported values. Repeated
references to the same object are allowed; circular references are rejected.

Incoming edits and `definition.validate()` reject the following values,
including when nested inside arrays or opaque `obj` fields:

- Functions, `undefined`, symbols, and BigInt.
- `NaN`, `Infinity`, and `-Infinity`.
- Dates, Maps, Sets, typed arrays, class instances, and other objects with custom
  prototypes. Arrays must have the ordinary array prototype.
- Sparse arrays, named enumerable properties on arrays, and enumerable symbol
  keys, which would lose information during JSON serialization.
- Enumerable getters/setters and custom `toJSON` methods. Data properties must
  contain values, rather than executable serialization behavior.

Validate loaded state with `definition.validate(data)` before storing, diffing,
or merging it. This checks the entire data structure and its schema. Subsequent
operations assume existing state already satisfies the contract, so unchanged
or ignored branches and no-op operations do not repeat that full check.

Setters always check incoming values, and updates check the entire incoming
batch before applying any edit. Passing `false` to a definition method skips
the resulting state's schema check; it does not disable incoming-data checks
or local path, own-property, prototype, and array protections. Schemas are also
checked when built. Invalid input throws; Sinks does not coerce data through a
JSON round trip.

```js
const definition = buildDefinition({ payload: 'obj', note: 'str' })
definition.validate(loadedData) // full data-contract and schema check
const next = definition.update(loadedData, { note: 'changed' }, false)
// Incoming edits checked; resulting schema check skipped.
```

The existing cleanup rules still apply: `null` deletes a value, and empty
objects and arrays are removed after updates. JSON compatibility does not
change these deletion semantics. Cleanup is immutable: it does not modify
existing state or incoming update values, and unchanged branches retain their
references.

#### Missing objects and array paths

An omitted or `undefined` starting object is treated as `{}`. The same default
applies to omitted comparison/merge objects and the object passed to
`definition.validate()`. An omitted, `undefined`, or `null` update batch remains
a no-op. `undefined` is never allowed as a field or array value; use `null` to
delete a field.

```js
updateObject(undefined, { name: 'Henrik' }) // { name: 'Henrik' }
updateObject({ name: 'Henrik' }, undefined) // unchanged
setValue({}, 'name', undefined) // throws
```

Array paths can replace an existing entry or append at the array's current
length. Skipping indexes throws because it would create a sparse array. Use
`[0]` to start a new array, then `[1]`, and so on; numeric strings without
brackets still create ordinary object keys when the branch is missing.

```js
setValue({}, 'items.[0].name', 'first') // { items: [{ name: 'first' }] }
setValue({}, 'items.[1].name', 'second') // throws: skipped index 0
```

#### Reserved keys and prototypes

Sinks reserves `__proto__`. It is rejected as a complete path segment or nested
object key, including wildcard IDs and values inside arrays. Substrings such as
`__proto__label` remain valid keys.

`constructor` and `prototype` are ordinary own data keys. They can be validated,
set with string or array paths, diffed, and merged, including when used as
wildcard IDs and as object fields inside arrays. Traversal only follows own
data containers. A missing branch is created fresh; Sinks never follows an
inherited constructor. Sinks processes own enumerable string-keyed properties
and does not copy or traverse inherited properties.

Own-property checks use the built-in `Object.prototype.hasOwnProperty` through
`call`, so they work with shadowed method names and null-prototype objects
without requiring the newer `Object.hasOwn` API.

#### Migrating to 5.0.0

- Rename any `__proto__` data keys.
- Convert Dates to strings or numeric timestamps, Maps/Sets to objects or
  arrays, and BigInt values to strings before passing them to Sinks.
- Omit unavailable fields or use `null` for deletion instead of assigning
  `undefined`. Supply dense arrays and finite numbers.
- Keep functions outside synchronized data. The built-in `func` type has been
  removed, and the `num` type now accepts only finite numbers.
- Call `definition.validate(data)` when loading existing state. A no-op update
  or diff is not a full data-contract check.

Custom validator functions remain supported as configuration through the second
argument to `buildDefinition`. They validate JSON-compatible values and cannot
override the data contract.

### `setValue(obj1, keyPath, updatedValue)`

This is the single-key update version of `updateObject` in fact, this what `updateObject` calls for each key you provide in the update object.

### `mergeObjects(obj1, obj2)`

This will get additive changes (not deletions) from each object compared to the other, and try to build a shared object of merged changes.

It returns an object with two properties:

1. `updated`: the new merged object
2. `conflicts`: this property only exists if there are conflicts. These conflicts are an object keyed by conflicting key name and containing an array of original and new values for that key.

```js
const obj1 = {
  name: 'bob',
  favoriteColor: 'blue',
}

const obj2 = {
  name: 'sue',
  age: 28,
}

const { updated, conflicts } = mergeObjects(obj1, obj2)

console.log(updated)
// {
//   name: 'bob', original name (no update was made)
//   age: 28, no conflict here, so age was applied from obj2
//   favoriteColor: 'blue', (no conflict so favoriteColor was
//     kept from first, notice it was *NOT* deleted.
// }
console.log(conflicts)
// {
//   name: ['bob', 'sue'] // value from first listed first
// }
```

## `buildDefinition(definitionObject, fnsObject[optional])` Using validation and object definitions

You can optionally choose to create a definition that describes valid shape of the object. Doing this can give you some comfort at runtime that you're not getting unexpected values.

`buildDefinition` returns an object with the following methods:

- `definition.validate(object)` takes object to validate,
- `definition.setValue(startingObject, keyPath, newValue, shouldValidate [defaults to true])`: ,
- `definition.update(startingObject, updatesObject, shouldValidate [defaults to true])`
- `definition.merge(startingObject, otherObject, shouldValidate [defaults to true])`

You define an object as follows. Please note that the "types" are just strings. These get mapped to functions you can supply as a second argument to `buildDefinition`.

If you don't supply one, we have a simple default set of very basic type checks out of the box. Please see `src/basic-types.js`. These are also exported as `import { basicTypes } from 'sinks'` so they can easily be extended.

```js
import { buildDefinition } from 'sinks'

// example definition
const bareDefinition = {
  // meta
  lastChanged: 'timestamp',
  lastSaved: 'timestamp',
  created: 'timestamp',

  // provider
  sedationProviderName: 'str',
  surgeonName: 'str',
  recorderName: 'str',
  office: 'str',

  // vitals types
  // the "{}" here allows for any keyed name.
  // This is very important when building state objects with unknown keys
  'trackedVitalTypes.{}.id': 'str',
  'trackedVitalTypes.{}.selected': 'bool',
  'trackedVitalTypes.{}.hasReceivedAutoValue': 'bool',

  // You can also define arrays
  medications: 'arr',
  'medications.[].id': 'str',
  'medications.[].name': 'str',
}

const definition = buildDefinition(bareDefinition)

// note you still have to supply the object each time
// it does not maintain state internally!
const startingObject = {}

// this will throw because it's not defined
try {
  const newObject = definition.setValue(
    startingObject,
    'somethingSilly',
    'blah'
  )
} catch (e) {
  // this will throw!!
}

// The same thing will not throw if we tell it not to validate
const finalObject = definition.setValue(
  startingObject,
  'somethingSilly',
  'blah',
  false // here we turn *off* validation
)

// NOTE: these are immutable sets!
// any object in the chain that has been edited
// has been copied and replaced.
console.log(startingObject === finalObject) // false
```

## Running tests

```
npm test
```

The test suite uses Node.js' built-in test runner. CI runs on Node.js 22, and the package requires Node.js 20 or newer.

## install

```
npm install sinks
```

## Change log

- `5.0.0`: Breaking release for JSON-compatible data. Incoming edits and explicit `definition.validate()` reject functions, nested `undefined`, symbols, BigInt, non-finite numbers, circular references, sparse arrays, array metadata, accessors, custom serialization methods, and custom prototypes. Existing state is expected to be validated when loaded; unchanged/ignored branches and no-op operations do not repeat the full data check. Removes `func` and makes `num` finite-only; custom validator functions remain supported as configuration. Missing object arguments still default to empty objects. Null/empty cleanup is immutable and shared with array-diff normalization. Empty new array entries are normalized so generated updates apply without holes; existing array edits remain granular. Reserves `__proto__`, uses own properties, and preserves literal `constructor`/`prototype` data fields and null-prototype objects. Incoming checks and local safety protections stay enabled when schema validation is disabled. Own-property checks work without `Object.hasOwn`. Removes the `dlv` runtime dependency.
- `4.0.0`: Breaking release. Ships plain ESM source instead of bundled `dist` files, removes CommonJS/UMD entrypoints, requires Node.js 20+, switches tests to Node.js' built-in test runner, and treats explicit `null` tombstones as equivalent to already-missing values in `getChanges()`.
- `3.1.4`: Fixed build errors caused by recent dependency changes
- `3.1.3`: Some more, minor performance improvements for validate() functions by doing a bit more pre-sorting.
- `3.1.2`: Bugfixes and 10x performance improvement of validate() function.
- `3.1.1`: Now exporting `simpleObjectDeepEqual` as part of main export.
- `3.1.0`: Added `simpleObjectDeepEqual` utility for lightweight object comparisons of simple objects.
- `3.0.4`: Added other test for `getChanges` to ensure it handle nested objects with integer keys correctly.
- `3.0.3`: Fixed bug where `getChanges` not handle objects with integer keys correctly.
- `3.0.2`: Fix bad prepublish script.
- `3.0.1`: Removing unnecessary conditional check.
- `3.0.0`: `getChanges` now returns individual key path updates, this is important for simultaneous changes of nested objects. Technically, this should not be a breaking change unless you manually modify or somehow deal with the changes object. But since it changes the shape of something returned by public API I decided to bump the major version.
- `2.0.0`: Now recursively removes all keys with values `{}`, `[]`, or `null` at the end of all set/update operations.
- `1.0.0`: `getChanges` now takes an options object instead of just a boolean and that option option now can take a `ignoredKeys: []` option to ignore changes to specified top-level keys.
- `0.0.1`: First public release.

## credits

If you like this follow [@HenrikJoreteg](http://twitter.com/henrikjoreteg) on twitter.

Props to [Jason Miller](https://github.com/developit) for [dlv](https://github.com/developit/dlv), used in earlier releases, and [Frank Wilkerson](https://github.com/fwilkerson) for [clean-set](https://github.com/fwilkerson/clean-set) which I modified and included here (along with his MIT license).

## license

[MIT](http://mit.joreteg.com/)
