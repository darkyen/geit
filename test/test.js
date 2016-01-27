const assert = require('assert');
const geit = require('../index');

describe('Repository', function() {
  describe('#refs()', function() {
    it('should return an error when the repo does not exist', function(done) {
      this.timeout(10000);
      const repo = geit('https://example.com/');
      repo.refs(function(refs, err) {
        assert.deepEqual(refs, null);
        assert.deepEqual(err.message, '404 Not Found');
        done();
      });
    });
  });

  describe('#tree()', function() {
    it('should return an error when the branch does not exist', function(done) {
      this.timeout(10000);
      const repo = geit('https://github.com/h2so5/geit.git');
      repo.tree('null', function(tree, err) {
        assert.deepEqual(tree, null);
        assert.deepEqual(err.message, 'no such branch or tag');
        done();
      });
    });
  });

  describe('#blob()', function() {
    it('should return an error when the id does not represent a blob object', function(done) {
      this.timeout(10000);
      const repo = geit('https://github.com/h2so5/geit.git');
      repo.blob('b8d6926f1b80437d8ddc8a75e21de886132ff838', function(blob, err) {
        assert.deepEqual(blob, null);
        assert.deepEqual(err.message, 'blob object not found');
        done();
      });
    });

    it('should return an error when the id does not exist', function(done) {
      this.timeout(10000);
      const repo = geit('https://github.com/h2so5/geit.git');
      repo.blob('b8d6926f1b80437d8ddc8a75e21de886132ff839', function(blob, err) {
        assert.deepEqual(blob, null);
        assert.deepEqual(err.message, 'object not found');
        done();
      });
    });
  });
});
