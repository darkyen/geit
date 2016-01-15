const geit = require('../index');
const os = require('os');
const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));

function extractTree(repo, tree, dir) {
  for (var name in tree) {
    (function(name) {
      var item = tree[name];
      if (item.children == null) {
        repo.blob(item.object, function(blob, err) {
          var filePath = path.join(dir, name);
          if (item.mode === '120000') {
            fs.linkSync(filePath, blob.toString());
          } else if (item.mode === '160000') {
            fs.mkdirSync(filePath);
          } else {
            var mode = parseInt(item.mode.slice(-3), 8);
            fs.writeFileSync(filePath, blob, { mode: mode });
          }
        });
      } else {
        var dirPath = path.join(dir, name);
        fs.mkdirSync(dirPath);
        extractTree(repo, item.children, dirPath);
      }
    })(name);
  }
}

var repo = geit(argv._[0], {});

repo.refs(function(refs, err) {
  if (argv.refs) {
    console.log(refs);
    return;
  }

  var ref = 'HEAD';
  if (argv.b) {
    if (refs['refs/heads/' + argv.b]) {
      ref = 'refs/heads/' + argv.b;
    } else if (refs['refs/tags/' + argv.b]) {
      ref = 'refs/tags/' + argv.b;
    } else {
      console.warn(argv.b + ' not found');
      return;
    }
  }

  repo.tree(refs[ref], function(tree, err) {
    if (argv.tree) {
      console.log(tree);
      return;
    }

    const dir = argv._[1];
    fs.mkdirSync(dir);
    extractTree(repo, tree, dir);
  });
});
