# geit

[![Build Status](https://travis-ci.org/h2so5/geit.svg?branch=master)](https://travis-ci.org/h2so5/geit)

Simply get source code trees from a git repository via Smart HTTP.

- No git command-line tool required
- Caching git objects with [levelup](https://github.com/level/levelup) (Using [memdown](https://github.com/level/memdown) as a backend by default)
- Supporting HTTP Authentication, proxies, etc. with [request](https://github.com/request/request)

## Installation

```bash
$ npm install --save geit
```

## Examples

### Get README.md on HEAD

```javascript
const geit = require('geit');
var repo = geit('https://github.com/h2so5/geit.git');

repo.refs(function(refs, err) {
  var commitID = refs['HEAD'];
  console.log('HEAD ID: ' + commitID);

  repo.tree(commitID, function(tree, err) {
    var blobID = tree['README.md'].object;
    console.log('Blob ID: ' + blobID);

    repo.blob(blobID, function(data, err) {
      console.log(data.toString());
    });
  });
});
```

### HTTP Authentication
```javascript
var repo = geit('https://github.com/h2so5/geit.git', {
  request: {
    auth: { user: 'username', pass: 'password' },
  },
});
```

### Use leveldown instead of memdown
```bash
$ npm install --save leveldown
```

```javascript
const levelup = require('levelup');
var repo = geit('https://github.com/h2so5/geit.git', {
  db: levelup('./geit.db'),
});
```

## API

### `geit(url[, options]) -> [Repository]`

#### Arguments
- `url` String - Repository URL
- `options` Object
  - `db` Object - [levelup](https://github.com/level/levelup) database object
  - `request` - Additional options for [request](https://github.com/request/request)

### `repo.refs(callback)`

#### Arguments
- `callback` Function
  - `refs` Object - Git references
  - `err` Object - Error

### `repo.tree(id, callback)`

#### Arguments
- `id` String - Commit ID
- `callback` Function
  - `tree` Object - Git tree
  - `err` Object - Error

### `repo.blob(id, callback)`

#### Arguments
- `id` String - Blob ID
- `callback` Function
  - `blob` Buffer - Blob data
  - `err` Object - Error
