'use strict';

const request = require('request');
const crypto = require('crypto');
const levelup = require('levelup');
const memdown = require('memdown');
const pako = require('./inflate');

function readPktLine(data) {
  if (data.length < 4) {
    throw new Error('pkt-line: unexpected EOF');
  }

  const length = parseInt(data.slice(0, 4).toString(), 16);
  if (length > 1 && length < 4) {
    throw new Error('pkt-line: invalid line length');
  }

  if (data.length < length) {
    throw new Error('pkt-line: unexpected EOF');
  }

  return {
    data: data.slice(4, length),
    rest: data.slice((length > 0) ? length : 4),
  };
}

function encodePktLine(data) {
  if (data == null) {
    return new Buffer('0000');
  }

  const buf = new Buffer(data);
  if (data.length > 65535 - 4) {
    throw new Error('pkt-line: too long line');
  }

  const length = ('000' + (buf.length + 4).toString(16)).slice(-4);
  return Buffer.concat([new Buffer(length), buf]);
}

function parseRefList(line) {
  const regex = /^([0-9a-f]{40})\s(\S+)(?:\0(.+))?\n$/;
  const match = regex.exec(line);
  if (match === null) {
    throw new Error('git-upload-pack: wrong list format');
  }

  return {
    id: match[1],
    name: match[2],
    capList: match[3],
  };
}

function parseGitRefs(data) {
  const service = readPktLine(data);
  if (service.data.toString() != '# service=git-upload-pack\n') {
    throw new Error('git-upload-pack: wrong first line');
  }

  const del = readPktLine(service.rest);
  if (del.data.length > 0) {
    throw new Error('git-upload-pack: "0000" expected');
  }

  let rest = del.rest;
  let refList = [];
  while (true) {
    let ref = readPktLine(rest);
    if (ref.data.length > 0) {
      refList.push(parseRefList(ref.data));
    } else {
      break;
    }

    rest = ref.rest;
  }

  return refList;
}

function objectID(type, data) {
  if (type < 1 || type > 7) {
    throw new Error('wrong object type');
  }

  let name;
  switch (type) {
    case 1: name = 'commit'; break;
    case 2: name = 'tree';   break;
    case 3: name = 'blob';   break;
    case 4: name = 'tag';    break;

    case 6: name = 'ofs-delta'; break;
    case 7: name = 'ref-delta'; break;
  }

  const sha1 = crypto.createHash('sha1');
  sha1.update(name + ' ' + data.length + '\0');
  sha1.update(data);

  return sha1.digest('hex');
}

function parsePackFile(data) {
  if (data.length < 13) {
    throw new Error('pack-file: unexpected EOF');
  }

  if (data.slice(0, 4).toString() !== 'PACK') {
    throw new Error('pack-file: "PACK" expected');
  }

  const version = data.readUInt32BE(4, true);
  if (!(version !== 2 || version !== 3)) {
    throw new Error('pack-file: unsupported version');
  }

  let count = data.readUInt32BE(8, true);
  let offset = 12;
  let objects = {};
  let ofsObjects = {};
  let refDeltaObjects = {};
  let ofsDeltaObjects = {};
  let array = new Uint8Array(data);

  while (count > 0) {
    const headerOffset = offset;
    const typelen = data[offset];
    const type = (typelen & 0x70) >> 4;
    let next = typelen & 0x80;
    let length = (typelen & 0xf);
    let bit = 4;

    offset++;
    while (next) {
      if (data.length < offset + 1) {
        throw new Error('pack-file: unexpected EOF');
      }

      const byte = data[offset];
      length |= ((byte & 0x7f) << bit);
      next = byte & 0x80;
      bit += 7;
      offset++;
    }

    if (type < 1 || type > 7) {
      throw new Error('pack-file: wrong object type');
    }

    let object = {
      type: type,
    };

    if (type == 6) {
      let negativeOffset = 0;
      let next = true;

      while (next) {
        if (data.length < offset + 1) {
          throw new Error('delta: unexpected EOF');
        }

        const byte = data[offset];
        negativeOffset = (negativeOffset << 7) | (byte & 0x7f);
        if (next = byte & 0x80) {
          negativeOffset += 1;
        }

        offset++;
      }

      const base = ofsObjects[headerOffset - negativeOffset];
      if (base == null) {
        throw new Error('ofs-delta: base object not found');
      }

      object.base = base.id;
    } else if (type == 7) {
      object.base = data.slice(offset, offset + 20).toString('hex');
      offset += 20;
    }

    const deflated = array.subarray(offset);
    const inflator = new pako.Inflate();
    inflator.push(deflated, true);
    if (inflator.err) {
      throw new Error(inflator.msg);
    }

    const content = new Buffer(inflator.result);
    object.id = objectID(type, content);
    object.data = content;

    if (type === 6) {
      ofsDeltaObjects[object.id] = object;
    } else if (type === 7) {
      refDeltaObjects[object.id] = object;
    } else {
      objects[object.id] = object;
    }

    ofsObjects[headerOffset] = object;
    offset += inflator.consumed;
    count--;
  }

  return {
    objects: objects,
    refDeltaObjects: refDeltaObjects,
    ofsDeltaObjects: ofsDeltaObjects,
  };
}

function parseCommitObject(data) {
  const treeRegexp = /tree\s([0-9a-f]{40})/;
  const parentRegexp = /parent\s([0-9a-f]{40})/;
  let commit = {};
  let match;
  if (match = treeRegexp.exec(data)) {
    commit.tree = match[1];
  } else {
    throw new Error('commit: "tree" not found');
  }

  if (match = parentRegexp.exec(data)) {
    commit.parent = match[1];
  }

  return commit;
}

function parseTreeObject(data) {
  let tree = {};

  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(' ', offset);
    const mode = data.slice(offset, space).toString();
    offset = space + 1;
    const zero = data.indexOf(0, offset);
    const name = data.slice(offset, zero).toString();
    offset = zero + 1;
    const object = data.slice(offset, offset + 20).toString('hex');
    offset += 20;
    tree[name] = {
      mode: ('00000' + mode).slice(-6),
      object: object,
    };
  }

  return tree;
}

function parseGitUploadPackResult(data) {
  let rest = data;
  while (rest.length > 0) {
    const nak = readPktLine(rest);
    rest = nak.rest;
    if (nak.data.toString() === 'NAK\n') {
      break;
    }
  }

  return parsePackFile(rest);
}

function applyDelta(base, delta) {
  let source = 0;
  let target = 0;

  let offset = 0;
  let next = true;
  let bit = 0;

  while (next) {
    if (delta.length < offset + 1) {
      throw new Error('delta: unexpected EOF');
    }

    let byte = delta[offset];
    source |= ((byte & 0x7f) << bit);
    next = byte & 0x80;
    bit += 7;
    offset++;
  }

  next = true;
  bit = 0;
  while (next) {
    if (delta.length < offset + 1) {
      throw new Error('delta: unexpected EOF');
    }

    const byte = delta[offset];
    target |= ((byte & 0x7f) << bit);
    next = byte & 0x80;
    bit += 7;
    offset++;
  }

  if (base.data.length !== source) {
    throw new Error('delta: source length mismatch');
  }

  const targetData = new Buffer(target);
  let targetOffset = 0;

  while (offset < delta.length) {
    const operation = delta[offset];
    if (operation & 0x80) {
      let copyOffset = 0;
      let copyLength = 0;
      let shift = 0;

      if (operation & 0x8) {
        copyOffset = delta[++offset];
        shift += 8;
      }

      if (operation & 0x4) {
        copyOffset |= delta[++offset] << shift;
        shift += 8;
      }

      if (operation & 0x2) {
        copyOffset |= delta[++offset] << shift;
        shift += 8;
      }

      if (operation & 0x1) {
        copyOffset |= delta[++offset] << shift;
      }

      shift = 0;
      if (operation & 0x40) {
        copyLength = delta[++offset];
        shift += 8;
      }

      if (operation & 0x20) {
        copyLength |= delta[++offset] << shift;
        shift += 8;
      }

      if (operation & 0x10) {
        copyLength |= delta[++offset] << shift;
      }

      base.data.copy(targetData, targetOffset, copyOffset, copyOffset + copyLength);
      targetOffset += copyLength;
    } else {
      delta.copy(targetData, targetOffset, offset + 1, offset + operation + 1);
      targetOffset += operation;
      offset += operation;
    }

    offset++;
  }

  return {
    type: base.type,
    data: targetData,
    id: objectID(base.type, targetData),
  };
}

function geit(url, option) {
  const geitRequest = request.defaults(Object.assign({
    gzip: true,
    headers: {
      'user-agent': 'git/geit',
    },
  }, option == null ? {} : option.request));

  let objectCache;
  let objectQueue = {};

  if (option == null) {
    option = {};
  }

  if (option.db == null) {
    objectCache = levelup(url, { db: require('memdown') });
  } else {
    objectCache = option.db;
  }

  function getObject(id) {
    return new Promise((resolve, reject) => {
      objectCache.get(id + '.type', (err, type) => {
        if (!err) {
          objectCache.get(id + '.data', { asBuffer: true, valueEncoding: 'binary' }, (err, data) => {
            if (!err) {
              resolve({
                type: parseInt(type, 10),
                data: data,
                id: id,
              });
            } else {
              reject(err);
            }
          });
        } else {
          reject(err);
        }
      });
    });
  }

  function putObject(object) {
    return new Promise((resolve, reject) => {
      objectCache.put(object.id + '.type', object.type.toString(), (err) => {
        if (!err) {
          objectCache.put(object.id + '.data', object.data, (err) => {
            if (!err) {
              resolve();
            } else {
              reject(err);
            }
          });
        } else {
          reject(err);
        }
      });
    });
  }

  var processingRequest = Promise.resolve();

  function processPack(queue, data) {
    let promise = Promise.resolve();
    let pack = parseGitUploadPackResult(data);
    var k = Object.keys(pack.objects);
    for (let id in pack.objects) {
      let object = pack.objects[id];
      promise = promise.then(function() {
        return putObject(object).then(function() {
          if (queue[id] != null) {
            queue[id].resolve(object);
          }

          return Promise.resolve();
        });
      });
    }

    for (let id in pack.refDeltaObjects) {
      let delta = pack.refDeltaObjects[id];
      promise = promise.then(function() {
        return getObject(delta.base).then((base) => {
          return applyDelta(base, delta.data);
        })
        .then((object) => {
          return putObject(object).then(function() {
            if (queue[object.id] != null) {
              queue[object.id].resolve(object);
            }

            return Promise.resolve();
          });
        })
        .catch(() => {
          return Promise.resolve();
        });
      });
    }

    for (let id in pack.ofsDeltaObjects) {
      let delta = pack.ofsDeltaObjects[id];
      promise = promise.then(function() {
        return getObject(delta.base).then((base) => {
          return applyDelta(base, delta.data);
        })
        .then((object) => {
          return putObject(object).then(function() {
            if (queue[object.id] != null) {
              queue[object.id].resolve(object);
            }

            for (let idx in pack.ofsDeltaObjects) {
              let delta = pack.ofsDeltaObjects[idx];
              if (delta.base === id) {
                delta.base = object.id;
              }
            }

            return Promise.resolve();
          });
        })
        .catch(() => {
          return Promise.resolve();
        });
      });
    }

    return promise;
  }

  function requestObjects() {
    let body = new Buffer(0);

    let first = true;
    for (let id in objectQueue) {
      let object = objectQueue[id];
      if (!object.requested) {
        let line;
        if (first) {
          line = 'want ' + id + ' ofs_delta\n';
          first = false;
        } else {
          line = 'want ' + id + '\n';
        }

        body = Buffer.concat([body, encodePktLine(line)]);
      }
    }

    body = Buffer.concat([body, encodePktLine('deepen 1')]);
    body = Buffer.concat([body, encodePktLine(null)]);
    body = Buffer.concat([body, encodePktLine('done\n')]);

    let queue = Object.assign({}, objectQueue);

    const refUrl = url + '/git-upload-pack';

    processingRequest = processingRequest.then(() => {
      return new Promise((resolve, reject) => {
        geitRequest.post(refUrl, {
          body: body,
          headers: {
            accept: 'application/x-git-upload-pack-result',
            'content-type': 'application/x-git-upload-pack-request',
          },
        })
        .on('response', (response) => {
          let data = new Buffer(0);
          if (response.statusCode != 200) {
            let err = new Error(response.statusCode + ' ' + response.statusMessage);
            for (let id in queue) {
              queue[id].reject(err);
            }
          } else {
            response.on('data', (buf) => {
              data = Buffer.concat([data, buf]);
            }).on('end', function() {
              processPack(queue, data).then(() => {
                resolve();
              });
            });
          }
        })
        .on('error', (err) => {
          for (let id in queue) {
            queue[id].reject(err);
          }

          reject(err);
        });
      });
    });

    objectQueue = {};
  }

  function fetchObject(id) {
    return processingRequest.then(() => {
      return getObject(id).then((obj) => {
        return Promise.resolve(obj);
      })
      .catch(() => {
        let promise = objectQueue[id];
        if (promise == null) {
          promise = new Promise((resolve, reject) => {
            objectQueue[id] = {
              resolve: resolve,
              reject: reject,
              requested: false,
            };
          });

          requestObjects();
        }

        return promise;
      });
    });
  }

  function fetchTree(tree) {
    let promises = [];
    for (let id in tree) {
      if (tree[id].mode === '040000') {
        let promise = fetchObject(tree[id].object)
        .then((obj) => {
          let subTree = parseTreeObject(obj.data);
          return fetchTree(subTree);
        })
        .then((object) => {
          tree[id].children = object;
        });

        promises.push(promise);
      }
    }

    return Promise.all(promises).then(() => {
      return tree;
    });
  }

  function refs(cb) {
    let refUrl = url + '/info/refs?service=git-upload-pack';
    let promise = new Promise((resolve, reject) => {
      geitRequest.get(refUrl)
      .on('response', (response) => {
        let data = new Buffer(0);
        if (response.statusCode != 200) {
          reject(new Error(response.statusCode + ' ' + response.statusMessage));
        } else {
          response.on('data', (buf) => {
            data = Buffer.concat([data, buf]);
          }).on('end', function() {
            try {
              let obj = parseGitRefs(data).reduce((obj, ref) => {
                obj[ref.name] = ref.id;
                return obj;
              }, {});

              resolve(obj);
            } catch (err) {
              reject(err);
            }
          });
        }
      })
      .on('error', (err) => {
        reject(err);
      });
    });

    if (cb) {
      promise.then((obj) => {
        cb(obj, null);
      }, (err) => {
        cb(null, err);
      });
    }

    return promise;
  }

  function blob(id, cb) {
    let promise = fetchObject(id).then((obj) => {
      if (obj == null || obj.type !== 3) {
        throw new Error('blob object not found');
      }

      return Promise.resolve(obj.data);
    }).catch((err) => {
      return Promise.reject(err);
    });

    if (cb) {
      promise.then((data) => {
        cb(data, null);
      }, (err) => {
        cb(null, err);
      });
    }

    return promise;
  }

  function tree(id, cb) {
    const idRegexp = /^[0-9a-f]{40}$/;
    let promise;
    if (idRegexp.test(id)) {
      promise = Promise.resolve(id);
    } else {
      promise = refs().then((res) => {
        let ref;
        if (ref = res[id]) {
          return ref;
        } else if (ref = res['refs/heads/' + id]) {
          return ref;
        } else if (ref = res['refs/tags/' + id]) {
          return ref;
        } else {
          return Promise.reject(new Error('no such branch or tag'));
        }
      });
    }

    promise = promise.then((id) => {
      return fetchObject(id);
    })
    .then((obj) => {
      if (obj == null || obj.type !== 1) {
        throw new Error('commit object not found');
      }

      const tree = parseCommitObject(obj.data).tree;
      return fetchObject(tree);
    })
    .then((obj) => {
      if (obj == null || obj.type !== 2) {
        throw new Error('tree object not found');
      }

      const tree = parseTreeObject(obj.data);
      return fetchTree(tree);
    });

    if (cb) {
      promise.then((data) => {
        cb(data, null);
      }, (err) => {
        cb(null, err);
      });
    }

    return promise;
  }

  return {
    refs: refs,
    blob: blob,
    tree: tree,
  };
}

module.exports = geit;
