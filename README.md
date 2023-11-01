# sinks

![](https://img.shields.io/npm/dm/sinks.svg)![](https://img.shields.io/npm/v/sinks.svg)![](https://img.shields.io/npm/l/sinks.svg)

A set of simple utilities for defining, validating, updating, diffing, and ultimately syncing (get it?!) state stored as simple objects and arrays.

Small enough for use in client-side code < 2kb. In fact, it's very handy if you're looking for a way to enforce more structure in redux reducers.

Enables validation (optional), deep immutable setting of values, and efficient diffing.

## What does it do?

It was designed to be part of a system where data stored as simple objects needs to be synchronized between servers and clients yet allow for disconnected changes and caching state locally then synchronizing it again when reconnected.

## Basic use cases

1. You have a large object and a modified version of that large object, you want them to be the same, but you don't want to send the entire new object.

2. Defining/validating/updating objects stored in redux reducers. Updates are always immutable!

3. You want to define, at a high-level, a simple object shape where all values are optional but any values have to match defined shape and types.

4. You want to try merging two object not knowing if they have conflicting changes or not. Giving you the information about what properties are in conflict.

## Main exports

### `getChanges(originalObject, finalState, {includeDeletions: true, ignoredKeys: []})`

This will return an object containing changes that can be applied to another object using `updateObject()`. If there are no changes, returns `null`.

You it takes an optional options object where you can opt out of including deletions and you can specify a list of top-level object keys to ignore.

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

## install

```
npm install sinks
```

## Change log

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

Props to [Jason Miller](https://github.com/developit) for [dlv](https://github.com/developit/dlv) (a dependency) and [Frank Wilkerson](https://github.com/fwilkerson) for [clean-set](https://github.com/fwilkerson/clean-set) which I modified and included here (along with his MIT license).

## license

[MIT](http://mit.joreteg.com/)
