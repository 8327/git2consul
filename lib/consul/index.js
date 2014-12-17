var fs = require('fs');
var path = require('path');

var logger = require('../logging.js');

var consul = require('consul')();

var token = undefined;

/* istanbul ignore next */
exports.setToken = function(tok) {
  token = tok;
}

var write_content_to_consul = function(branch, resource_name, content, cb) {
  // Prepend repo name and branch name to the KV so that the subtree is properly namespaced in Consul
  var key_name = branch.repo_name + '/' + resource_name;
  logger.trace('Adding key %s, value %s', key_name, content);
  consul.kv.set({'key': key_name, value: content, token: token}, function(err) {
    if (err) {
      return cb('Failed to write key ' + key_name + ' due to ' + err);
    }
    cb();
  });
};

/**
 * If a file was modified, read its new value and update consul's KV store.
 */
var file_modified = function(branch, file, cb) {

  var fqf = branch.branch_directory + path.sep + file;

  logger.trace('Attempting to read "%s"', fqf);

  fs.readFile(fqf, {encoding:'utf8'}, function(err, body) {
    /* istanbul ignore if */
    if (err) return cb('Failed to read key ' + fqf + ' due to ' + err);
    var body = body ? body.trim() : '';
    var resource_name = (branch.include_branch_name ? branch.name + "/" : "") + file;
    write_content_to_consul(branch, resource_name, body, cb);
  });
};

/**
 * If a file was deleted, remove it from consul's KV store.
 */
var file_deleted = function(branch, file, cb) {
  // Prepend branch name to the KV so that the subtree is properly namespaced in Consul
  var key_name = branch.repo_name + (branch.include_branch_name ? '/' + branch.name : "" ) + '/' + file;
  logger.trace('Deleting key %s', key_name);
  consul.kv.del({'key': key_name, token: token}, function(err) {
    /* istanbul ignore if */
    if (err) return cb('Failed to delete key ' + key_name + ' due to ' + err);
    cb();
  });
};

/**
 * This function expects an array of objects of the following form:
 *
 *   {
 *       'type': 'Any of [AMTDTC]',
 *       'path': 'Path of the file within the repo'
 *   }
 *
 * This function will loop over those objects, handle them, and fire its callback once all records
 * have been processed.  If any errors were noted in the underlying operations, the callback will
 * include the array of errors as the first parameter.
 */
var process_records = function(branch, records, cb) {

  var pending_records = 0;
  var errors_seen = [];

  var check_pending = function(err) {
    if (err) {
      errors_seen.push(err);
    }

    --pending_records;

    // If there are no pending records, callback with all errors seen, if any.
    if (pending_records === 0) {
      cb((errors_seen.length > 0) ? errors_seen : null);
    }

    // TODO: Add a watchdog timer?  It's a bit scary that this method may never fire its callback if
    // one of the underlying consul operations hangs, especially since the branch_manager is locked
    // waiting for this update to complete.
  };

  records.forEach(function(record) {
    logger.trace('Handling record %s of type %s', record.path, record.type);

    switch (record.type) {
      // Update files that were Added (A), Modified (M), or had their type (i.e. regular file, symlink, submodule, ...) changed (T)
      case 'M':
      case 'A':
      case 'T':
        // Store added/modified file
        ++pending_records;
        file_modified(branch, record.path, check_pending);
        break;
      case 'D':
        // Delete file
        ++pending_records;
        file_deleted(branch, record.path, check_pending);
        break;
      /* istanbul ignore next */
      default:
        logger.error('Unknown git status %s', record.type);
    }
  });
};

/**
 * Get the current ref that has been synced with Consul.
 */
exports.getLastProcessedRef = function(branch, cb) {
  var key_name = branch.repo_name + '/' + branch.name + '.ref';
  consul.kv.get({'key': key_name, token: token}, function(err, item) {
    /* istanbul ignore if */
    if (err) return cb(err);
    cb(null, item === undefined ? item : item.Value);
  });
};

/**
 * Store the current ref that has been synced with Consul.
 */
exports.setLastProcessedRef = function(branch, ref, cb) {
  write_content_to_consul(branch, branch.name + '.ref', ref, cb);
};

/**
 * Update consul to match the current state of the branch represented by branch_manager.  In any other case
 * than a fresh clone, we know the prior state of the branch and can determine what files changed since the
 * last time we synced with consul.  In the case of a fresh clone, we just assume that the clone is an accurate
 * representation of what's in consul and add all present files.
 */
exports.handleRefChange = function(branch, cb) {

  // First, check to see what the current ref is for this branch.
  branch.getCurrentRef(function(err, ref) {
    /* istanbul ignore if */
    if (err) return cb("Failed to get current ref for branch " + branch.name + " due to " + err);

    /**
     * Given a set of records, process them and update the branch manager to the current ref if successful.
     */
    var handle_records = function(err, records) {
      /* istanbul ignore if */
      if (err) return cb(err);
      process_records(branch, records, function(errs) {
        if (errs) {
          return cb("Some consul updates failed:\n" + errs.join('\n'));
        }
        // Note: This is a bit dangerous.  We only update most recent ref is all consul writes are successful.
        // If there's a bug that causes a certain consul write to always fail, we will always create our diffs
        // from the ref before that file was added.
        exports.setLastProcessedRef(branch, ref, function(err) {
          return cb(err);
        });
      });
    };

    // If there's a ref present on the branch_manager, diff consul between that branch and the current state
    exports.getLastProcessedRef(branch, function(err, last_processed_ref) {
      /* istanbul ignore if */
      if (err) return cb(err);

      if (!last_processed_ref) {
        // If there's no ref from which to do a delta update, we just assume all files in the tree are valid values
        // and pass them to consul.
        branch.listAllFiles(handle_records);
      } else {
        if (last_processed_ref === ref) {
          // We have already processed this update.
          return cb(null, "Ref " + ref + " already processed for branch " + branch.name);
        } else {
          // Find diffs between most_recent_ref and current_ref
          branch.listChangedFiles(last_processed_ref, ref, handle_records);
        }
      }
    });
  });
};
