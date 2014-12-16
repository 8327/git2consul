var _ = require('underscore');
var should = require('should');

// We want this above any git2consul module to make sure logging gets configured
require('./git2consul_bootstrap_test.js');

var git = require('../lib/git/');
var git_commands = require('../lib/git/commands.js');
var Repo = require('../lib/git/repo.js');
var git_utils = require('./utils/git_utils.js');

describe('Config Validation', function() {
  
  it ('should reject a repo with invalid config', function() {

    try {
      var repo = new Repo();
      should.fail("Repo with no config should throw an exception");
    } catch(e) {
      e.message.should.equal('No configuration provided for repo');
    }

    [{}, {'name':'incomplete'}, {'name':'incomplete', 'branches': ['master']}].forEach(function(config) {
      try {
        var repo = new Repo(config);
        should.fail("Repo with incomplete config should throw an exception");
      } catch(e) {
        e.message.should.equal('A repo must have a url, a name, and a branch array.');
      }
    });
  });

  it ('should reject a config using an existing repo name', function(done) {
    git_utils.initRepo(function(err, repo) {
      if (err) return done(err);
      var config = {
        local_store: git_utils.TEST_WORKING_DIR,
        repos: [git_utils.createRepoConfig(), git_utils.createRepoConfig()]
      };

      var callback_seen = false;
      git.createRepos(config, function(err) {
        err.should.equal("A repo with that name is already tracked.");
        if (callback_seen) {
          done();
        } else callback_seen = true;
      });
    });
  });

  it ('should reject a repo with a bogus local_store', function(done) {
    git_commands.init(git_utils.TEST_REMOTE_REPO, function(err) {
      if (err) return done(err);
      var config = {
        local_store: "/var/permdenied",
        repos: [git_utils.createRepoConfig()]
      };

      var callback_seen = false;
      git.createRepos(config, function(err) {
        err.should.startWith("Failed to create local store");
        done();
      });
    });
  });

  it ('should reject a repo with duplicate branches', function() {
    try {
      var repo = new Repo({'name': 'busted_dupe_branch_repo', 'url': 'http://www.github.com/', 'branches': ['master', 'master', 'commander']});
      should.fail("Repo with duplicate branches should throw an exception");
    } catch(e) {
      e.message.should.startWith('Duplicate name found in branches for repo busted_dupe_branch_repo');
    }
  });

  it ('should reject a repo with a broken git url', function(done) {
    var repo = new Repo(_.extend(git_utils.createRepoConfig(), { url: 'file:///tmp/nobody_home' }));
    repo.init(function(err) {
      err.message.should.containEql('does not appear to be a git repository');
      done();
    });
  });

  it ('should reject an invalid git hook type', function(done) {
    git_commands.init(git_utils.TEST_REMOTE_REPO, function(err) {
      if (err) return done(err);

      // When we create a repo, we need it to have an initial commit.  The call to addFile provides that.
      git_utils.addFileToGitRepo("readme.md", "Stub file to give us something to commit.", "Init repo.", function(err) {

        if (err) return cb(err);
        var config = {
          local_store: git_utils.TEST_WORKING_DIR,
          repos: [git_utils.createRepoConfig()]
        };

        config.repos[0].hooks = [{'type':'unknown'}];

        var callback_seen = false;
        git.createRepos(config, function(err) {
          err.should.startWith("Failed to load repo test_repo due to Invalid hook type unknown");
          done();
        });
      });
    });
  });

  /**

  it ('should handle config validation if multiple repos initialized at the same time', function(done) {

    var stock_config = git_utils.createConfig();
    _.extend(stock_config.repos[0], { 'hooks': [{ 'type': 'unknown' } ]});

    git_manager.manageRepos(stock_config, function(err, gm) {
      err[0][0].should.startWith('Invalid hook type');
      done();
    });
  });
**/
});
