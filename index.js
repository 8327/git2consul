var logging = require('./lib/utils/logging.js')
var config_reader = require('./lib/utils/config_reader.js');

var util = require('util');

config_reader.read(function(err, config) {
  
  if (err) return console.error(err);
  
  console.log(util.inspect(config));
  
  logging.init(function() {
    
    var logger = require('./lib/utils/logging.js');

    var git_manager_source = require('./lib/git_manager.js');
    
    if (!config.repos || !config.repos.length > 0) {
      // Fail startup.
      logger.error("No repos found in configuration.  Halting.")
      process.exit(1);
    }
  
    // TODO: Complete repo config validation
    logger.info('git2consul is running');
  
    // Set up the git manager for each repo.
    git_manager_source.createGitManagers(config.repos, function(err) {
      if (err) {
        logger.error('Failed to create git managers due to %s', err);
        setTimeout(function() {
          // If any git manager failed to start, consider this a fatal error.
          process.exit(2);
        }, 2000);
      }
    });
  });
  
});
