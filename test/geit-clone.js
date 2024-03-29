"use strict";

const geit = require('../index');
const os = require('os');
const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));

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

const repo = geit(argv._[0], {});
const ref = argv.b ? argv.b : 'HEAD';

repo.tree(ref, function(tree, err) {
  if (argv.tree) {
    console.log(tree);
    return;
  }

  const dir = argv._[1];
  extractTree(repo, tree, dir);
});
