var util = require('util');

var express = require('express');
var bodyParser = require('body-parser');

var logger = require('../utils/logging.js');

// Create an object to map from host port to app.  Multiple hosts can be configured to listen
// on the same port.
var server_apps = {};

/**
 * Create a listener for calls from the Webhook, whether stash or github.
 */
function init_express(config) {

  // Validate config.  Fail if the provided config matches an existing host / port combination.
  /* istanbul ignore next */
  if (!config) throw 'Invalid config provided to webhook';
  if (!config.port || isNaN(config.port)) throw 'Invalid webhook port ' + config.port;
  if (!config.url) throw 'No config url provided';

  var server_app = server_apps[config.port];
  if (!server_app) {
    server_app = {};

    var app = express();
    server_app.app = app;

    // Stash's webhook sends a totally bogus content-encoding.  Smack it before the body parser runs.
    app.use(function() {
      return function(req, res, next) {
        // TODO: Fill in with correct value.
        if (req.headers['content-encoding'] == 'stash') {
          delete req.headers['content-encoding'];
        }
        next();
      }
    }());

    // Parse application/json
    app.use(bodyParser.json());

    app.listen(config.port);

    server_app.url = config.url;
    server_apps[config.port] = server_app;
  } else {
    // Two webhooks can't have the same url and port, so fail if this is the case.
    if (server_app.url === config.url) {
      throw "A webhook is already listening on " + config.port + ", " + config.url;
    }
  }

  return server_app.app;
}

exports.github = {
  init: function(config, git_manager) {
    var app = init_express(config);

    // We don't care what method is used, so use them all.
    ['get','post','put','delete'].forEach(function(verb) {
      app[verb](config.url, function(req, res){
        logger.info('Got pinged by github hook, checking results');

        logger.debug(util.inspect(req.body))

        /* istanbul ignore else */
        if (req && req.body && req.body.ref && req.body.head_commit && req.body.head_commit.id) {
          // Only pull changed branches
          var ref = req.body.ref;
          var to_hash = req.body.head_commit.id;
          logger.debug('Handling reference change to %s', util.inspect(ref));

          // Only update if the head of a branch changed
          /* istanbul ignore else */
          if (ref.indexOf('refs/heads/') === 0) {
            // Strip leading 'refs/heads/' from branch name
            var branch_name = ref.substring(11);

            // Update consul git branch
            var bm = git_manager.getBranchManager(branch_name);
            if (!bm) {
              logger.trace('No branch_manager for branch %s, ignoring.', branch_name);
              return res.send('ok');
            }
            bm.handleRefChange(to_hash, function(err) {
              /* istanbul ignore next */
              if (err) {
                logger.error(err);
                return res.send('ok');
              }

              logger.debug('Updates in branch %s complete', branch_name);
            });
          }
        }

        res.send('ok');
      });
    });

    logger.info('Github listener initialized at http://localhost:%s%s', config.port, config.url);
  }
};

exports.stash = {
  init: function(config, git_manager) {
    var app = init_express(config);

    // We don't care what method is used, so use them all.
    ['get','post','put','delete'].forEach(function(verb) {
      app[verb](config.url, function(req, res){

        var old_send = res.send;
        var this_obj = this;

        //console.log(util.inspect(req.body));
        logger.info('Got pinged by stash hook, checking results');

        logger.debug(util.inspect(req.body))

        /* istanbul ignore else */
        if (req && req.body && req.body.refChanges) {
          // Only pull changed branches
          for (var i=0; i<req.body.refChanges.length; ++i) {
            var refChange = req.body.refChanges[i];

            logger.debug('Handling reference change %s', util.inspect(refChange));

            // Only update if the head of a branch changed
            /* istanbul ignore else */
            if (refChange.refId && (refChange.refId.indexOf('refs/heads/') === 0) && refChange.toHash) {
              // Strip leading 'refs/heads/' from branch name
              var branch_name = refChange.refId.substring(11);

              // Update consul git branch
              var bm = git_manager.getBranchManager(branch_name);
              if (!bm) {
                logger.trace('No branch_manager for branch %s, ignoring.', branch_name);
                return res.send('ok');
              }
              bm.handleRefChange(refChange.toHash, function(err) {
                /* istanbul ignore next */
                if (err) {
                  logger.error(err);
                  return res.send('ok');
                }

                logger.debug('Updates in branch %s complete', branch_name);
              });
            }
          };
        }

        res.send('ok');
      });
    });

    logger.info('Stash listener initialized at http://localhost:%s%s', config.port, config.url);
  }
};
