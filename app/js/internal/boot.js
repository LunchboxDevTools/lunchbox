'use strict';

var os      = require('os');
var fs      = require('fs');
var Q       = require('q');
var yaml    = require('yamljs');

var qc      = load_mod('tools/qchain');
var storage = load_mod('internal/storage');

/**
 * Boot tasks.
 */
module.exports = (function () {
  return {
    /**
     * Sets up links between menu items and their associated view files.
     * 
     * @param  {[type]} dialog [description]
     * @return {[type]}        [description]
     */
    setupNavigation: function (dialog) {
      var nav = load_mod('components/nav');
      nav.setContainer('#view-wrap');

      var deferred = qc.defer();

      var items = [];

      $('nav a').each(function (i, el) {
        el = $(el);
        items.push(el);

        if (el.attr('href') != '#') {
          nav.addNavItem(el, function (err) {
            if (err) {
              console.log('error: ' + err);
              return;
            }

            // remove 'active' class from all nav items
            items.forEach(function (item, i) {
              $(item).parent().removeClass('active');
            });

            // add 'active' class to clicked nav item
            el.parent().addClass('active');
          });
        }
      });

      deferred.resolve();
      
      return deferred.promise;
    },

    /**
     * Loads & parses settings.yaml into the `window.lunchbox` object.
     * 
     * @param  {[type]} dialog [description]
     * @return {[type]}        [description]
     */
    loadSettings: function (dialog) {
      var deferred = Q.defer();

      dialog.append('Loading Lunchbox settings.' + os.EOL);

      storage.load(function (error, data) {
        if (error !== null) {
          deferred.reject(error);
        }

        if (data == null) {
          data = {};
        }

        if (typeof data.plugins == 'undefined') {
          data.plugins = [];
        }

        if (typeof data.views == 'undefined') {
          data.views = {
            dashboard: {},
            settings: {}
          };
        }

        var remote = require('remote');
        var app = remote.require('app');
        data.user_data_path = app.getPath('userData');
        data.plugins_path = data.user_data_path + '/plugins';

        window.lunchbox = data;

        deferred.resolve();
      });

      return deferred.promise;
    },

    /**
     * Checks for presense of plugins directory; creates it if missing.
     * @param  {[type]} dialog [description]
     * @return {[type]}        [description]
     */
    checkPluginsDir: function (dialog) {
      var deferred = Q.defer();

      dialog.append('Checking for plugins.' + os.EOL);

      fs.stat(window.lunchbox.plugins_path, function (error, stats) {
        if (error || !stats.isDirectory()) {
          dialog.append('Plugins directory not found; attepting to create.' + os.EOL);

          var mode = parseInt('0700', 8);
          fs.mkdir(window.lunchbox.plugins_path, mode, function (error) {
            if (error) {
              deferred.reject('Could not create plugins directory: ' + window.lunchbox.plugins_path);

              return;
            }

            dialog.append('Created plugins directory: ' + window.lunchbox.plugins_path + '.' + os.EOL);
            deferred.resolve();
          });

          return;
        }

        dialog.append('Found plugins directory: ' + window.lunchbox.plugins_path + '.' + os.EOL);
        deferred.resolve();
      });

      return deferred.promise;
    },

    /**
     * Ensures all plugins in window.lunchbox.plugins have codebases, and match Lunchbox
     * plugin requirements.
     * 
     * @param  {[type]} dialog [description]
     * @return {[type]}        [description]
     */
    checkPlugins: function (dialog) {
      var chain = Q.fcall(function (){});
      
      // no plugins present
      if (!window.lunchbox.plugins.length) {
        return chain;
      }
      
      // build a promise chain where each link handles a single plugin
      var found_plugins = [];
      window.lunchbox.plugins.forEach(function (plugin) {
        var link = function () {
          var deferred = Q.defer();

          fs.stat(plugin.path, function (error, stats) {
            dialog.append('Checking plugin: ' + plugin.name_nice + '.' + os.EOL);
            
            // plugin files found, so save this plugin to the "found" array
            if (!error && stats.isDirectory()) {
              found_plugins.push(plugin);
              deferred.resolve();
              return;
            }
            
            dialog.append('Plugin files not found in ' + plugin.path + '. Removing plugin.' + os.EOL);
            deferred.resolve();
          });
          
          return deferred.promise;
        }
        
        chain = chain.then(link);
      });
      
      // now that we've checked all plugins, update the plugin object with the
      // array of found plugins
      chain = chain.then(function () {
        window.lunchbox.plugins = found_plugins;
        storage.save(window.lunchbox, storage_save_callback);
      });
      
      return chain;
    },

    /**
     * Checks provision status and shows alert.
     * 
     * @param  {[type]} dialog [description]
     * @return {[type]}        [description]
     */
    checkProvisionStatus: function (dialog) {
      var deferred = qc.defer();

      dialog.append('Checking provision status.' + os.EOL);
      
      if (window.lunchbox.settings.vm.needs_reprovision) {
        show_reprovision_notice();
      }

      deferred.resolve();

      return deferred.promise;
    },

    /**
     * Runs through a series of Promise-based checks against npm and general
     * software dependencies. 
     * 
     * @return {Object} A promise object (wrapper for all individual promises).
     */
    checkPrerequisites: function (dialog) {
      // npm dependencies
      qc.add(function () {
        var deferred = qc.defer();

        require('check-dependencies')().then(function (result) {
          if (!result.depsWereOk) {
            deferred.reject('Unmet npm dependencies. Please run "npm install" in the project directory.');
            return;
          }

          deferred.resolve(null);
        });

        return deferred.promise;
      });

      // general software dependencies
      var software = [{
        // virtualbox
        name: 'VirtualBox',
        command: 'vboxmanage --version',
        regex: /(\d+\.\d+\.\d+)/i,
        version: '5.0.10'
      }, {
        // vagrant
        name: 'Vagrant',
        command: 'vagrant --version',
        regex: /Vagrant (\d+\.\d+\.\d+)/i,
        version: '1.7.4',
        help: {
          darwin: [
            'Vagrant can be installed via a binary: http://www.vagrantup.com/downloads, or',
            'using Homebrew: http://sourabhbajaj.com/mac-setup/Vagrant/README.html'
          ],
          linux: [
            'Vagrant can be installed via a binary: http://www.vagrantup.com/downloads, or',
            'via command line: http://www.olindata.com/blog/2014/07/installing-vagrant-and-virtual-box-ubuntu-1404-lts'
          ],
          win32: 'Vagrant can be installed via a binary: http://www.vagrantup.com/downloads'
        }
      }, {
        // vagrant vbguest plugin
        name: 'Vagrant VBGuest Plugin',
        command: 'vagrant plugin list',
        regex: /vagrant-vbguest \((\d+\.\d+\.\d+)\)/i,
        version: '0.11.0',
        help: "Vagrant VBGuest Plugin can be installed by running 'vagrant plugin install vagrant-vbguest'."
      }, {
        // vagrant hostsupdater  plugin
        name: 'Vagrant HostsUpdater Plugin',
        command: 'vagrant plugin list',
        regex: /vagrant-hostsupdater \((\d+\.\d+\.\d+)\)/i,
        version: '1.0.1',
        help: "Vagrant HostsUpdater Plugin can be installed by running 'vagrant plugin install vagrant-hostsupdater'."
      }];

      /*
       {
        // ansible
        name: 'Ansible',
        command: 'ansible --version',
        regex: /ansible (\d+\.\d+\.\d+)/i,
        version: '1.9.4',
        help: {
          darwin: [
            'Ansible installation instructions: https://valdhaus.co/writings/ansible-mac-osx,',
            'http://docs.ansible.com/ansible/intro_installation.html',
            '',
            'If you encounter the "Error: cannot find role" issue, ensure that /etc/ansible/roles is owned by your user.'
          ],
          linux: [
            'Ansible installation instructions: http://docs.ansible.com/ansible/intro_installation.html',
            '',
            'If you encounter the "Error: cannot find role" issue, ensure that /etc/ansible/roles is owned by your user.'
          ],
          win32: 'Ansible installation instructions: http://docs.ansible.com/ansible/intro_windows.html'
        }
      }
      */

      var exec = require('child_process').exec;

      software.forEach(function (item) {
        qc.add(function () {
          var deferred = qc.defer();
          
          exec(item.command, [], function (error, stdout, stderr) {
            if (error !== null) {
              var error_text = [
                'Could not find ' + item.name + '; ensure it is installed and available in PATH.',
                '\tTried to execute: ' + item.command,
                '\tGot error: ' + stderr
              ];

              if (item.help) {
                // generic help for all platforms
                if (typeof item.help == 'string') {
                  error_text.push(item.help);
                }
                // platform-specific help
                else if (typeof item.help == 'object') {
                  if (item.help[process.platform]) {
                    // array-ize the string
                    if (typeof item.help[process.platform] !== 'object') {
                      item.help[process.platform] = [item.help[process.platform]];
                    }

                    for (var i in item.help[process.platform]) {
                      error_text.push(item.help[process.platform][i]);
                    }
                  }
                }
              }

              deferred.reject(error_text.join(os.EOL));

              return;
            }

            if (item.regex) {
              var matches = stdout.match(item.regex);
              if (matches) {
                var cv = require('compare-version');

                // >= 0 is all good
                if (cv(matches[1], item.version) < 0) {
                  deferred.reject(item.name + ' was found, but a newer version is required. Please upgrade ' + item.name + ' to version ' + item.version + ' or higher.');
                }

                item.found_version = matches[1];
              }
              else {
                deferred.reject(item.name + ' was found, but the version could not be determined.');
              }
            }

            dialog.append(item.name + ' found.' + os.EOL);
            deferred.resolve(item);
          });

          return deferred.promise;
        });
      });

      // // test process w/ required user input
      // qc.add(function () {
      //   var deferred = qc.defer();

      //   // commands that require sudo should be ran with a -S flag; ex: "sudo -S ls"
      //   var child = require('child_process').exec('drush cc', []);

      //   dialog.setChildProcess(child);
      //   dialog.logProcess(child);

      //   child.on('close', function () {
      //     deferred.resolve(null);
      //   });

      //   return deferred.promise;
      // });

      // check for ansible, and if it is present, ensure ansible-galaxy install has
      // been run
      qc.add(function () {
        var deferred = qc.defer();

        exec('ansible --version', [], function (error) {
          // no ansible on host, no problem
          if (error !== null) {
            deferred.resolve(null);
            return;
          }

          // no error, so we have ansible and need to ensure all roles are in place
          dialog.append('Ansible found. Checking role requirements.' + os.EOL);

          var https = require('https');
          var source = 'https://raw.githubusercontent.com/geerlingguy/drupal-vm/master/provisioning/requirements.yml';

          https.get(source, function(res) {
            if (res.statusCode != 200) {
              deferred.reject('Could not get list of ansible roles. Expected list to be available at:' + os.EOL + '\t' + source);
              return;
            }

            var response = '';
            res.on('data', function(d) {
              response += d.toString('utf8');
            });

            res.on('end', function(d) {
              // build list of required roles
              var required = [];
              response.split("\n").forEach(function (line) {
                var parts = line.split(' ');
                if (parts.length == 3) {
                  required.push(parts.pop());
                }
              });

              var present = [];
              // build list of present roles
              exec('ansible-galaxy list', [], function (error, stdout, stderr) {
                if (error !== null) {
                  deferred.reject('Could not execute "ansible-galaxy list".');
                }

                stdout.split("\n").forEach(function (line) {
                  var parts = line.split(' ');
                  if (parts.length == 3) {
                    present.push(parts[1].replace(',', ''));
                  }
                });

                var delta = required.filter(function (item) {
                  return (present.indexOf(item) == -1);
                });

                if (delta.length) {
                  var error_text = [
                    'The following required ansible-galaxy roles are missing:'
                  ];

                  delta.forEach(function (item) {
                    error_text.push("\t" + item);
                  });

                  error_text.push('This can be fixed by running "ansible-galaxy install" as specified in the DrupalVM quickstart:');
                  error_text.push("\t" + ' https://github.com/geerlingguy/drupal-vm');
                  error_text.push('If you encounter the "Error: cannot find role" issue, ensure that /etc/ansible/roles is owned by your user.');

                  deferred.reject(error_text.join(os.EOL));
                  return;
                }

                deferred.resolve(null);
              });

            });

          }).on('error', function(error) {
            deferred.reject('Could not parse list of ansible roles. Received error:' + os.EOL + '\t' + error);
          });
        });

        return deferred.promise;
      });

      return qc.chain();
    },

    /**
     * Sets vagrant-related variables based on output of "vagrant global-status"
     * 
     * @param  {[type]} dialog [description]
     * @return {[type]}        [description]
     */
    detectDrupalVM: function (dialog) {
      var deferred = Q.defer();

      var spawn = require('child_process').spawn;
      var child = spawn('vagrant', ['global-status']);

      var stdout = '';
      dialog.logProcess(child, function (output) {
        stdout += output;
      });

      child.on('exit', function (exitCode) {
        // Search for the drupalvm entry and parse it into global config variables
        var lines = stdout.split("\n");
        for (var x in lines) {
          var parts = lines[x].split(/\s+/);

          // simply checking for the presense of 'drupalvm' in the line can cause
          // an issue if a non-drupalvm machine's filepath contains that string;
          // we need to check the machine name itself

          // Sample: d21e8e6  drupalvm virtualbox poweroff /home/nate/Projects/drupal-vm
          if (parts.length >= 5 && parts[1] == 'drupalvm') {
            window.lunchbox.settings.vm.id = parts[0];
            window.lunchbox.settings.vm.name = parts[1];
            window.lunchbox.settings.vm.state = parts[3];
            window.lunchbox.settings.vm.home = parts[4];

            var config_file = window.lunchbox.settings.vm.home + '/config.yml';
            window.lunchbox.settings.vm.config = yaml.load(config_file);

            storage.save(window.lunchbox.settings);

            deferred.resolve();
            return;
          }
        }

        deferred.reject('Could not find "drupalvm" virtualbox.');
      });

      return deferred.promise;
    }
  }
})();
