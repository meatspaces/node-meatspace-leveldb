'use strict';

var level = require('level');
var request = require('request');
var paginate = require('level-paginate');
var Sublevel = require('level-sublevel');
var concat = require('concat-stream');

var Meatspace = function (options) {
  if (!options.fullName || !options.postUrl || !options.username) {
    throw new Error('fullName, username, db and postUrl are mandatory');
  }

  var KEY = 'post!';

  var self = this;

  this.fullName = options.fullName;
  this.username = options.username;
  this.postUrl = options.postUrl;
  this.dbPath = options.db;
  this.limit = options.limit - 1 || 10;
  this.keyId = '';
  this.db = Sublevel(level(this.dbPath, {
    createIfMissing: true,
    valueEncoding: 'json'
  }));
  this.subscriptionLevel = this.db.sublevel(this.username + '!subscriptions');
  this.privateLevel = this.db.sublevel(this.username + '!private');
  this.publicLevel = this.db.sublevel(this.username + '!public');
  this.centralLevel = this.db.sublevel(this.username + '!central');

  var setTime = function () {
    return Date.now();
  };

  var setPublic = function (message, id, callback) {
    self.publicLevel.put(KEY + id, message, function (err) {
      if (err) {
        callback(err);
      } else {
        self.privateLevel.del(id, function (err) {
          if (err) {
            callback(err);
          } else {
            callback(null, message);
          }
        });
      }
    });
  };

  var setPrivate = function (message, id, callback) {
    self.privateLevel.put(KEY + id, message, function (err) {
      if (err) {
        callback(err);
      } else {
        self.publicLevel.del(id, function (err) {
          if (err) {
            callback(err);
          } else {
            callback(null, message);
          }
        });
      }
    });
  };

  this.create = function (message, callback) {
    if (!message || !this.fullName || !this.postUrl) {
      callback(new Error('Message invalid'));
    } else {
      message.id = setTime();
      message.username = this.username;
      message.fullName = this.fullName;
      message.content.created = message.id;
      this.update(message, callback);
    }
  };

  this.get = function (id, callback) {
    self.centralLevel.get(KEY + id, function (err, message) {
      if (err || !message) {
        callback(new Error('Not found ', err));
      } else {
        callback(null, message);
      }
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
    url = url.toLowerCase().trim();

    this.subscriptionLevel.put(url, true, function (err) {
      if (err) {
        callback(err);
      } else {
        callback(null, url);
      }
    });
  };

  this.unsubscribe = function (url, callback) {
    this.subscriptionLevel.del(url, function (err) {
      if (err) {
        callback(err);
      } else {
        callback(null, url);
      }
    });
  };

  this.getSubscriptions = function (callback) {
    var rs = this.subscriptionLevel.createReadStream();

    rs.pipe(concat(function (subscriptions) {
      callback(null, subscriptions);
    }));

    rs.on('error', function (err) {
      callback(err);
    });
  };

  this.getSubscriptionRecent = function (url, callback) {
    this.subscriptionLevel.get(url, function (err, subs) {
      url = url.toLowerCase().trim();

      if (err || !subs) {
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
  };

  this.update = function (message, callback) {
    message.content.updated = setTime();

    this.centralLevel.put(KEY + message.id, message, function (err) {
      if (err) {
        callback(err);
      } else {
        if (message.meta.isPrivate) {
          setPrivate(message, message.id, callback);
        } else {
          setPublic(message, message.id, callback);
        }
      }
    });
  };

  this.del = function (id, callback) {
    this.privateLevel.del(KEY + id);
    this.publicLevel.del(KEY + id);
    this.centralLevel.del(KEY + id);

    callback(null, true);
  };

  this.getAll = function (start, callback) {
    var rs = paginate(this.centralLevel, KEY, {
      page: start,
      num: self.limit
    });

    rs.pipe(concat(function (messages) {
      callback(null, messages);
    }));

    rs.on('error', function (err) {
      callback(err);
    });
  };

  this.shareRecent = function (start, callback) {
    var rs = paginate(this.publicLevel, KEY, {
      page: start,
      num: self.limit
    });

    rs.pipe(concat(function (messages) {
      callback(null, messages);
    }));

    rs.on('error', function (err) {
      callback(err);
    });
  };

  this.shareOne = function (id, callback) {
    this.publicLevel.get(KEY + id, function (err, message) {
      if (err || !message) {
        callback(new Error('This message is private or unavailable'));
      } else {
        callback(null, message);
      }
    });
  };
};

module.exports = Meatspace;
