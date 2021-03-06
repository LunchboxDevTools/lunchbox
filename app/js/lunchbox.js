var shell = require('shell');
var bootbox = require('bootbox');
var Q = require('q');
var os = require('os');

/***************************************************************
    Global items for access from all modules / files
***************************************************************/

require('./class.GenericSettings');
require('./class.LunchboxSettings');

require('./class.LunchboxPlugin');

// container for lunchbox data
window.lunchbox = {};
// settings data that will be written to settings.json; the only exception is
// window.lunchbox.settings.plugins.##.instance, which is meant for temporary
// plugin-related data, and gets auto-removed by storage during save operation
window.lunchbox.settings = function () {};

// the nav click callback will set this to the plugin responsible for the
// clicked nav item
window.active_plugin = false;

/**
 * Helper to load custom modules. Alleviates the need to provide a
 * relative filepath when loading a custom module from somewhere other than 
 * a file in /app/
 * 
 * @param  {[type]} src [description]
 * @return {[type]}     [description]
 */
window.load_mod = function (src) {
  return require('./' + src + '.js');
}

// shortcut reference
var settings = window.lunchbox.settings;

var qc = load_mod('tools/qchain');
var nav = load_mod('components/nav');

var drupalvm_running = false;

var DRUPALVM_START = "start";
var DRUPALVM_STOP = "stop";
var DRUPALVM_PROVISION = "provision";
var DRUPALVM_RELOAD = "reload";

// groups of startup operations; these will be performed sequentially; 
// each operation will only execute if the previous one completed successfully;
// these are separated into sub-groups so that a grouped subset of these
// operations can be re-executed at a later time (ex. running plugins and nav ops
// again when the "manage plugins" form is updated)
window.lunchbox_operations = {
  boot: [],
  plugins: [],
  nav: []
};

window.reloadCurrentView = function (callback) {
  nav.reloadCurrentView(callback);
};

/**
 * Runs operations in specified groups.
 * 
 * @param  {[type]} groups  [description]
 * @param  {[type]} args    [description]
 * @param  {[type]} success [description]
 * @param  {[type]} error   [description]
 * @param  {[type]} step    [description]
 * @return {[type]}         [description]
 */
window.runOps = function (groups, args, success, error, step) {
  // default to all groups
  groups = groups || Object.keys(window.lunchbox_operations);

  // default callbacks
  var success = success || function () {};
  var error = error || function () {};
  var step = step || function () {};

  // default arguments passed to each op
  var args = args || [];

  // build a flat array of operations from the desired groups
  var ops = [];
  for (var i in groups) {
    if (window.lunchbox_operations.hasOwnProperty(groups[i])) {
      for (var j in window.lunchbox_operations[groups[i]]) {
        ops.push(window.lunchbox_operations[groups[i]][j]);
      }
    }
  }

  // build a chain of promises from the operations
  var chain = Q.fcall(function (){});
  
  var op_count = 0;
  ops.forEach(function (item) {
    var link = function () {
      var deferred = Q.defer();
      
      item.apply(item, args).then(function (result) {
        op_count++;

        step(op_count, ops.length);

        deferred.resolve(result);
      }, function (error) {
        deferred.reject(error);
      });

      return deferred.promise;
    };

    chain = chain.then(link);
  });

  chain.then(success, error);
};

$(document).ready(function () {
  // build and run startup operations
  var boot = load_mod('internal/boot');
  var dialog = load_mod('components/dialog').create('Reading configuration...');

  var ops = window.lunchbox_operations;

  // boot group
  ops.boot.push(boot.loadSettings);
  ops.boot.push(boot.checkPluginsDir);
  // plugins group
  ops.plugins.push(boot.checkPlugins);
  ops.plugins.push(boot.bootPlugins);
  
  // navigation group
  ops.nav.push(boot.buildNavigation);

  // promise chain success callback
  var success = function (result) {
    dialog.hide();

    nav.loadFile(window.lunchbox.public_path + '/views/dashboard/dashboard.html', function (error) {
      if (error) {
        console.log('Error: ' + error);
      }

      // save the dialog's content for use in dashboard.js
      window.lunchbox.settings.views.dashboard.boot_log = encodeURI(dialog.getContent());
    });
  };

  // promise chain error callback
  var error = function (error) {
    dialog.append(error, 'error');
  };

  // promise chain step callback
  var step = function (count, total) {
    dialog.setProgress(count / total * 100);
  };

  runOps(null, [dialog], success, error, step);
});











// ------ Event Hookups ------ //

$("#provisionLink").click(function () {
  if(drupalvm_running) {
    controlVM(DRUPALVM_PROVISION);
  }
  else {
    controlVM(DRUPALVM_START);
  }
});

$("#drupalvm_start").click(function () {
  controlVM(DRUPALVM_START);
});


$("#drupalvm_stop").click(function () {
  controlVM(DRUPALVM_STOP);
});


$("#drupalvm_provision").click(function () {
  if(drupalvm_running) {
    controlVM(DRUPALVM_PROVISION);
  }
  else {
    controlVM(DRUPALVM_START);
  }
});

function drupalVMProcessing(modalTitle) {
  var contents = "<div class='progress'>";
  contents+= "<div class='progress-bar progress-bar-striped active' role=progressbar' aria-valuenow='100' aria-valuemin='0' aria-valuemax='100' style='width: 100%''>";
  contents+= "<span class='sr-only'>100% Complete</span>";
  contents+= "</div>";
  contents+= "</div>";
  contents+= "Details";
  contents+= "<div id='processingLog'>";
  contents+= "<pre></pre>";
  contents+= "</div>";

  var dialog = bootbox.dialog({
    title: modalTitle,
    message: contents
  });
}

function controlVM(action) {
  var title = '';
  var cmd = '';

  switch(action) {
    case DRUPALVM_START:
      cmd = 'up'
      title = 'Starting VM';
      break;

    case DRUPALVM_STOP:
      cmd = 'halt';
      title = 'Stopping VM';
      break;

    case DRUPALVM_PROVISION:
      cmd = 'provision';
      title = 'Re-provisioning VM';
      break;

    case DRUPALVM_RELOAD:
      cmd = 'reload';
      title = 'Reloading VM';
      break;
  }

  var spawn = require('child_process').spawn;
  var child = spawn('vagrant', [cmd, settings.vm.id]);

  var dialog = load_mod('components/dialog').create(title);
  dialog.logProcess(child);

  child.on('exit', function (exitCode) {
    switch(action) {
      case DRUPALVM_START:
        if (!window.lunchbox.vm.needs_reprovision) {
          updateVMStatus(dialog);
          return;
        }

        controlVM(DRUPALVM_PROVISION);

        break;

      case DRUPALVM_STOP:
      case DRUPALVM_RELOAD:
        updateVMStatus(dialog);

        break;

      case DRUPALVM_PROVISION:
        hide_reprovision_notice();
        updateVMStatus(dialog);

        break;
    }
  });
}
