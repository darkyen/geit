# geit 🐐

[![Build Status](https://travis-ci.org/h2so5/geit.svg?branch=master)](https://travis-ci.org/h2so5/geit)
[![npm version](https://badge.fury.io/js/geit.svg)](https://badge.fury.io/js/geit)

Simply get source code trees from a git repository via Smart HTTP.

- No git command-line tool required
- Caching git objects with [levelup](https://github.com/level/levelup) (Using [memdown](https://github.com/level/memdown) as a backend by default)
- Supporting HTTP Authentication, proxies, etc. with [request](https://github.com/request/request)

## Installation

```bash
$ npm install --save geit
```

## Examples

### Get 'README.md' on HEAD

(Same as `git cat-file -p HEAD:README.md`)

```javascript
const geit = require('geit');
const repo = geit('https://github.com/h2so5/geit.git');

repo.tree('HEAD', function(tree, err) {
  const blobID = tree['README.md'].object;

  repo.blob(blobID, function(data, err) {
    console.log(data.toString());
  });
});
```

### Get 'README.md' on HEAD (Promise)

```javascript
const geit = require('geit');
const repo = geit('https://github.com/h2so5/geit.git');

repo.tree('HEAD').then((tree) => {
  const blobID = tree['README.md'].object;
  
  return repo.blob(blobID);
}).then((data) => {
  console.log(data.toString());
});
```

### Extract all files in a tree

(Same as `git clone --depth 1` without .git directory)

```javascript
const geit = require('geit');
const path = require('path');
const fs = require('fs');

const repo = geit('https://github.com/h2so5/geit.git');

repo.tree('HEAD', function(tree, err) {
  extractTree(repo, tree, './geit');
});

function extractTree(repo, tree, dir) {
  fs.mkdirSync(dir);
  for (let name in tree) {
    const item = tree[name];
    const pathname = path.join(dir, name);
    switch (item.mode) {
      case '040000':  // directory
        extractTree(repo, item.children, pathname);
        break;
      case '120000':  // symbolic link
        repo.blob(item.object, function(blob, err) {
          fs.linkSync(pathname, blob.toString());
        });

        break;
      case '160000':  // submodule
        fs.mkdirSync(pathname);
        break;
      default:
        const mode = parseInt(item.mode.slice(-4), 8); // permissions
        repo.blob(item.object, function(blob, err) {
          fs.writeFileSync(pathname, blob, { mode: mode });
        });
    }
  }
}
```

### HTTP Authentication
```javascript
const repo = geit('https://github.com/h2so5/geit.git', {
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
const repo = geit('https://github.com/h2so5/geit.git', {
  db: levelup('./geit.db'),
});
```

## API

## `geit(url[, options]) -> [Repository]`

- `url` String - Repository URL
- `options` Object
  - `db` Object - [levelup](https://github.com/level/levelup) database object
  - `request` - Additional options for [request](https://github.com/request/request)

## `repo.refs([callback]) -> [Promise]`

- `callback` Function
  - `refs` Object - Git references
  - `err` Object - Error

## `repo.tree(id[, callback]) -> [Promise]`

- `id` String - Commit ID | Branch name | Tag name | Ref name
- `callback` Function
  - `tree` Object - Git tree
  - `err` Object - Error

## `repo.blob(id[, callback]) -> [Promise]`

- `id` String - Blob ID
- `callback` Function
  - `blob` Buffer - Blob data
  - `err` Object - Error
