'use strict';

var levelup = require('levelup');
var leveldown = require('leveldown');
var request = require('request');

var KEY = 'meatspace:';

var openDb = function (callback) {
  if (!self.db || self.db.isClosed()) {
    levelup(self.dbPath, {
      createIfMissing: true,
      keyEncoding: 'binary',
      valueEncoding: 'json'
    }, function (err, lp) {
      if (lp) {
        self.db = lp;
        callback();
      } else {
        openDb(callback);
      }
    });
  } else {
    callback();
  }
};

var Meatspace = function (options) {
  if (!options.fullName || !options.postUrl || !options.username) {
    throw new Error('fullName, username, db and postUrl are mandatory');
  }

  var self = this;

  this.fullName = options.fullName;
  this.username = options.username;
  this.postUrl = options.postUrl;
  this.dbPath = options.db;
  this.limit = options.limit - 1 || 10;
  this.keyId = '';

  var openDb = function (callback) {
    if (!self.db || self.db.isClosed()) {
      levelup(self.dbPath, {
        createIfMissing: true,
        keyEncoding: 'binary',
        valueEncoding: 'json'
      }, function (err, lp) {
        if (lp) {
          self.db = lp;
          callback();
        } else {
          openDb(callback);
        }
      });
    } else {
      callback();
    }
  };

  var addToArray = function (i, callback) {
    self.get(self.ids[i], function (err, m) {
      if (err) {
        callback(err);
      } else {
        self.messageArray.push(m);
      }

      if (self.messageArray.length === self.ids.length) {
        callback(null, self.messageArray);
      }
    });
  };

  var setAll = function (opts, message, id, callback) {
    self.db.get(KEY + 'all:ids' + self.keyId, function (err, ids) {
      if (err) {
        // Not created, so create a new array
        ids = [id];
      } else {
        if (ids.indexOf(id) === -1) {
          ids.unshift(id);
        }
      }

      opts.push({
        type: 'put',
        key: KEY + 'all:ids' + self.keyId,
        value: ids
      });

      opts.push({
        type: 'put',
        key: KEY + id,
        value: message
      });

      self.db.batch(opts, function (err) {
        if (err) {
          callback(err);
        } else {
          callback(null, message);
        }
      });
    });
  };

  var setPublic = function (opts, message, id, callback) {
    self.db.get(KEY + 'public:ids' + self.keyId, function (err, publicIds) {
      if (err) {
        publicIds = [];
      }

      if (!message.meta.isPrivate && publicIds.indexOf(id) === -1) {
        publicIds.unshift(id);

        opts.push({
          type: 'put',
          key: KEY + 'public:ids' + self.keyId,
          value: publicIds
        });
      }

      setAll(opts, message, id, callback);
    });
  };

  var setPrivate = function (opts, message, id, callback) {
    self.db.get(KEY + 'priv:ids' + self.keyId, function (err, privIds) {
      if (err) {
        privIds = [];
      }

      if (message.meta.isPrivate && privIds.indexOf(id) === -1) {
        privIds.unshift(id);

        opts.push({
          type: 'put',
          key: KEY + 'priv:ids' + self.keyId,
          value: privIds
        });
      }

      setPublic(opts, message, id, callback);
    });
  };

  this.create = function (message, callback) {
    if (!message || !this.fullName || !this.postUrl) {
      callback(new Error('Message invalid'));
    } else {
      var opts = [];

      openDb(function () {
        self.db.get(KEY + 'ids', function (err, id) {
          if (err) {
            id = 1;
          } else {
            id ++;
          }

          opts.push({
            type: 'put',
            key: KEY + 'ids',
            value: id
          });

          message.id = id;
          message.fullName = self.fullName;
          message.username = self.username;
          if (!message.postUrl) {
            message.postUrl = self.postUrl;
          }
          message.content.created = message.content.updated = Math.round(new Date() / 1000);

          setPrivate(opts, message, id, callback);
        });
      });
    }
  };

  this.get = function (id, callback) {
    openDb(function () {
      self.db.get(KEY + id, function (err, message) {
        if (err || !message) {
          callback(new Error('Not found ', err));
        } else {
          if (typeof message === 'object') {
            callback(null, message);
          } else {
            callback(new Error('Invalid JSON'));
          }
        }
      });
    });
  };

  this.share = function (message, url, callback) {
    if (message.shares.indexOf(this.postUrl) < 0) {
      message.meta.isShared = true;
      message.postUrl = url;
      message.shares.push(url);

      self.create(message, callback);
    } else {
      callback(new Error('Already shared'));
    }
  };

  this.subscribe = function (url, callback) {
    openDb(function () {
      self.db.get(KEY + 'subscriptions' + self.keyId, function (err, subs) {
        if (err) {
          subs = {};
        }

        url = url.toLowerCase().trim();
        subs[url] = true;

        self.db.put(KEY + 'subscriptions' + self.keyId, subs, function (err) {
          if (err) {
            callback(err);
          } else {
            callback(null, url);
          }
        });
      });
    });
  };

  var loadSubscriptions = function (subs, callback) {
    var subscriptions = [];
    var subsLength = Object.keys(subs).length;

    if (subsLength > 0) {
      for (var s in subs) {
        subscriptions.push(s);

        if (subscriptions.length === subsLength) {
          callback(null, subscriptions);
        }
      }
    } else {
      callback(null, subscriptions);
    }
  };

  this.unsubscribe = function (url, callback) {
    openDb(function () {
      self.db.get(KEY + 'subscriptions' + self.keyId, function (err, subs) {
        if (err) {
          subs = {};
        }

        delete subs[url.toLowerCase().trim()];

        self.db.put(KEY + 'subscriptions' + self.keyId, subs, function (err) {
          if (err) {
            callback(err);
          } else {
            loadSubscriptions(subs, callback);
          }
        });
      });
    });
  };

  this.getSubscriptions = function (callback) {
    openDb(function () {
      self.db.get(KEY + 'subscriptions' + self.keyId, function (err, subs) {
        if (err) {
          callback(null, []);
        } else {
          loadSubscriptions(subs, callback);
        }
      });
    });
  };

  this.getSubscriptionRecent = function (url, callback) {
    openDb(function () {
      self.db.get(KEY + 'subscriptions' + self.keyId, function (err, subs) {
        url = url.toLowerCase().trim();

        if (err || !subs[url]) {
          callback(new Error('Subscription messages not found or you did not subscribe to this url'));
        } else {
          request(url, function (err, resp, body) {
            if (err) {
              callback(err);
            } else {
              if (typeof body !== 'object') {
                try {
                  body = JSON.parse(body);
                } catch (e) {
                  return callback(new Error('Could not parse JSON'));
                }
              }

              var recentArr = [];

              for (var i = 0; i < body.posts.length; i ++) {
                recentArr.push(body.posts[i]);

                if (recentArr.length === body.posts.length) {
                  callback(null, recentArr);
                }
              }
            }
          });
        }
      });
    });
  };

  var loadAll = function (ids, callback) {
    self.messageArray = [];
    self.ids = ids;

    if (self.ids.length > 0) {
      for (var i = 0; i < self.ids.length; i ++) {
        addToArray(i, callback);
      }
    } else {
      callback(null, self.messageArray);
    }
  };

  var resetPublic = function (opts, message, callback) {
    self.db.get(KEY + 'public:ids' + self.keyId, function (err, publicIds) {
      if (!publicIds) {
        publicIds = [];
      }

      if (message.meta.isPrivate) {
        publicIds.splice(publicIds.indexOf(message.id), 1);
      } else if (publicIds.indexOf(message.id) === -1) {
        publicIds.unshift(message.id);
      }

      opts.push({
        type: 'put',
        key: KEY + 'public:ids' + self.keyId,
        value: publicIds
      });

      self.db.get(KEY + message.id, function (err, msg) {
        if (err) {
          callback(err);
        } else {
          message.content.updated = Math.round(new Date() / 1000);

          opts.push({
            type: 'put',
            key: KEY + message.id,
            value: message
          });

          self.db.batch(opts, function (err) {
            if (err) {
              callback(err);
            } else {
              callback(null, message);
            }
          });
        }
      });
    });
  };

  this.update = function (message, callback) {
    openDb(function () {
      self.db.get(KEY + 'priv:ids' + self.keyId, function (err, privIds) {
        var opts = [];

        if (!privIds) {
          privIds = [];
        }

        if (message.meta.isPrivate) {
          privIds.unshift(message.id);
        } else if (privIds.indexOf(message.id) === -1) {
          privIds.splice(privIds.indexOf(message.id), 1);
        }

        opts.push({
          type: 'put',
          key: KEY + 'priv:ids' + self.keyId,
          value: privIds
        });

        resetPublic(opts, message, callback);
      });
    });
  };

  var delPublic = function (opts, id, callback) {
    self.db.get(KEY + 'public:ids' + self.keyId, function (err, publicIds) {
      if (err) {
        callback(err);
      } else {
        publicIds.splice(publicIds.indexOf(id), 1);

        opts.push({
          type: 'put',
          key: KEY + 'public:ids' + self.keyId,
          value: publicIds
        });

        self.ids.splice(self.ids.indexOf(id), 1);

        self.db.batch(opts, function (err) {
          if (err) {
            callback(err);
          } else {
            callback(null, true);
          }
        });
      }
    });
  };

  var delPrivate = function (opts, id, callback) {
    self.db.get(KEY + 'priv:ids' + self.keyId, function (err, privIds) {
      if (err) {
        callback(err);
      } else {
        privIds.splice(privIds.indexOf(id), 1);

        opts.push({
          type: 'put',
          key: KEY + 'priv:ids' + self.keyId,
          value: privIds
        });

        delPublic(opts, id, callback);
      }
    });
  };

  this.del = function (id, callback) {
    openDb(function () {
      id = parseInt(id, 10);
      var opts = [];

      opts.push({
        type: 'del',
        key: KEY + id
      });

      self.db.get(KEY + 'all:ids' + self.keyId, function (err, ids) {
        if (err) {
          callback(err);
        } else {
          ids.splice(ids.indexOf(id), 1);

          opts.push({
            type: 'put',
            key: KEY + 'all:ids' + self.keyId,
            value: ids
          });

          delPrivate(opts, id, callback);
        }
      });
    });
  };

  this.getAll = function (start, callback) {
    openDb(function () {
      start = parseInt(start, 10);

      if (isNaN(start)) {
        start = 0;
      }

      self.db.get(KEY + 'all:ids' + self.keyId, function (err, cids) {
        if (err) {
          callback(err);
        } else {
          self.totalAll = cids.length;
          loadAll(cids.slice(start, self.limit + start + 1), callback);
        }
      });
    });
  };

  this.getAllIds = function (callback) {
    openDb(function () {
      self.db.get(KEY + 'all:ids' + self.keyId, function (err, cids) {
        if (err) {
          callback(err);
        } else {
          callback(null, cids);
        }
      });
    });
  };

  this.shareRecent = function (start, callback) {
    openDb(function () {
      start = parseInt(start, 10);

      if (isNaN(parseInt(start, 10))) {
        start = 0;
      }

      self.db.get(KEY + 'public:ids' + self.keyId, function (err, cids) {
        if (err) {
          callback(err);
        } else {
          self.totalPublic = cids.length;
          loadAll(cids.slice(start, self.limit + start + 1), callback);
        }
      });
    });
  };

  this.shareOne = function (id, callback) {
    openDb(function () {
      self.get(id, function (err, message) {
        if (err) {
          callback(err);
        } else {
          if (message.meta.isPrivate) {
            callback(new Error('This is private'));
          } else {
            callback(null, message);
          }
        }
      });
    });
  };

  this.flush = function (dbPath) {
    leveldown.destroy(dbPath || self.dbPath, function (err) {
      console.log('Deleted database');
    });
  };
};

module.exports = Meatspace;
