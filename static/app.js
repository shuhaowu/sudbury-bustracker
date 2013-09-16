"use strict";

if (navigator.mozApps) {
// From https://gist.github.com/potch/2586957
  var mozApp=function(){function e(){return!!c}function f(a,c){var d=navigator.mozApps.install(b);return d.onsuccess=a,d.onerror=c,d.addEventListener("error",function(){alert("Installation Failed with Error: "+this.error.name)}),d}function g(){return c?c.uninstall():void 0}var a=document.querySelector('link[rel="app-manifest"]'),b=a.href,c=!1,d=navigator.mozApps.getSelf();return d.onsuccess=function(){c=d.result},{isRunning:e,install:f,uninstall:g,manifest:b}}();
}
$(function() {
  $('.navbar-ex1-collapse').click('li', function() {
      $('.navbar-ex1-collapse').collapse('hide');
  });
});

(function() {
  var app = angular.module("sbt", ["ngRoute", "angularIndexedDb"]);

  app.config(["$routeProvider", "$locationProvider", function($routeProvider, $locationProvider) {
    $locationProvider.html5Mode(true);

    $routeProvider.when("/", {
      controller: "MainController",
      templateUrl: "main"
    });

    $routeProvider.when("/about", {
      templateUrl: "about"
    });

    $routeProvider.when("/failure", {
      templateUrl: "failure"
    });

    $routeProvider.when("/stop/:stopnum", {
      controller: "OneStopController",
      templateUrl: "onestop"
    });

    $routeProvider.otherwise({
      redirectTo: "/"
    });
  }]);

  // this is if there's an autochecking task every 20 seconds for the
  // one stop screen
  var check;

  app.run(["$location", "$rootScope", "$timeout", function($location, $rootScope, $timeout) {
    $rootScope.$on("idbfailure", function() {
      $location.path("/failure");
    });

    $rootScope.$on("$routeChangeSuccess", function(e, current, previous) {
      if ($location.path() === "/") {
        $('.navbar-brand').text("Better Sudbury Bus Tracker");
      } else {
        $('.navbar-brand').html("<span class=\"glyphicon glyphicon-chevron-left\"></span>");
      }

      if (check) {
        $timeout.cancel(check);
      }
    });
  }]);

  var checkIdb = function(DataService, $location) {
    if (DataService.idbfailure) {
      $location.path("/failure");
    }
  };

  var toast = function(msg, level, unsafe) {
    $("#alert").removeClass().addClass("alert").addClass("alert-"+level);
    if (unsafe)
      $("#alert-text").html(msg);
    else
      $("#alert-text").text(msg);
  };

  var networkFailure = function() {
    toast("It looks like the network is down.", "danger");
  };

  var wtf = function() {
    console.log("wtf called");
    toast("Uh oh.. something bad happened. You should report this to <a href=\"/about\">me</a>.", "danger", "unsafe");
  };

  app.service("DataService", ["$rootScope", "$http", "$q", "angularIndexedDb", function($rootScope, $http, $q, idb) {
    var self = this;

    this.idbfailure = false;
    this.idbna = false;
    var omaigawd = function(err) {
      if (err === undefined) {
        this.idbna = true;
      }
      self.idbfailure = true;
      $rootScope.$broadcast("idbfailure");
    };

    this.db = idb.open("sbt", 1, function(db) {
      $("#welcome-message").removeClass("hidden");
      db.createObjectStore("stops", {keyPath: "number"});
    });

    this.db.then(undefined, omaigawd);

    this.checkStop = function(stopnum) {
      return $http({
        method: "GET",
        url: "/check/" + stopnum
      });
    };

    this.addStop = function(stopnum, stopname) {
      var deferred = $q.defer();
      this.checkStop(stopnum).then(
        function(args) {
          var data = args.data;
          if (!stopname) {
            stopname = data.stopname;
          }

          self.db.then(function(db) {
            var store = db.transaction(["stops"], "readwrite").objectStore("stops");
            store.put({number: stopnum, stopname: stopname}).then(function() {
              deferred.resolve();
            }, function() { deferred.reject(); wtf(); });
          });
        },
        function(args) {
          if (args.status === 400) {
            toast(args.data.error, "danger");
            deferred.reject();
          } else {
            deferred.reject();
            networkFailure();
          }
        }
      );

      deferred.promise.then(function() {
        $rootScope.$broadcast("stop-changed", stopnum);
      });

      return deferred.promise;
    };

    this.listStops = function() {
      var deferred = $q.defer();

      this.db.then(function(db) {
        var store = db.transaction(["stops"]).objectStore("stops");
        var stops = [];

        store.openCursor(IDBKeyRange.lowerBound(0)).then(function(result) {
          if (!result) {
            deferred.resolve(stops);
            return;
          }

          stops.push(result.value);
          result.continue();
        });

      }, function() { deferred.reject(); wtf(); });

      return deferred.promise;
    };

    this.getStop = function(stopnum) {
      var deferred = $q.defer();

      this.db.then(function(db) {
        var store = db.transaction(["stops"]).objectStore("stops");
        store.get(stopnum).then(function(stop) {
          deferred.resolve(stop);
        }, function() { deferred.reject(); wtf(); });
      });

      return deferred.promise;
    };

    this.deleteStop = function(stopnum) {
      var deferred = $q.defer();

      this.db.then(function(db) {
        var store = db.transaction(["stops"], "readwrite").objectStore("stops");
        store.delete(stopnum).then(function() {
          deferred.resolve();
        }, function() { deferred.reject(); wtf(); });
      });

      return deferred.promise;
    };

  }]);


  app.controller("MainController", ["$scope", "$location", "$timeout", "DataService", function($scope, $location, $timeout, DataService) {
    checkIdb(DataService, $location);

    var refreshList = function() {
      $scope.loaded = false;
      $timeout(function() {
        $scope.stops = DataService.listStops();
        $scope.stops.then(function() {
          $scope.loaded = true;
        });
      }, 0);
    };

    $scope.$on("stop-changed", refreshList);

    refreshList();

    $scope.check = function() {
      if (!$scope.checknum) {
        toast("You need a stop code to check.", "danger");
        return;
      }
      $location.path("/stop/" + $scope.checknum);
    };
  }]);

  app.controller("OneStopController", ["$scope", "$location", "$route", "$timeout", "DataService", function($scope, $location, $route, $timeout, DataService) {
    checkIdb(DataService, $location);

    var stockStopname;

    $scope.refresh = function() {
      $scope.loaded = false;
      $scope.number = null;
      DataService.checkStop($route.current.params.stopnum).then(function(args) {
        $scope.updated = new Date().toLocaleTimeString();
        $scope.loaded = true;
        $scope.number = args.data.number;
        stockStopname = args.data.stopname;

        // Makes sure that custom name overrides. This is incase that there's no
        // custom name.
        if (!$scope.stopname) {
          $scope.stopname = stockStopname;
        }
        $scope.nodeparture = args.data.nodeparture;
        $scope.busses = args.data.busses;
      }, function(args) {
        if (args.status == 400) {
          alert("Stop " + $route.current.params.stopnum + " does not exist!");
          $location.path("/");
        } else {
          networkFailure();
        }
      });
    };

    var job = function() {
      $scope.refresh();
      check = $timeout(job, 20000);
    };

    job();

    // Get the custom name
    DataService.getStop($route.current.params.stopnum).then(function(stop) {
      if (!stop) {
        if (stockStopname) {
          $scope.stopname = stockStopname;
        }
      } else {
        $scope.stopname = stop.stopname;
      }
    });

    $scope.delete = function() {
      if ($scope.number) {
        if (confirm("Are you sure you want to delete this stop?")) {
          DataService.deleteStop($scope.number).then(function() {
            $location.path("/");
          });
        }
      }
    };

  }]);

  app.controller("NavbarController", ["$scope", "$location", "DataService", function($scope, $location, DataService) {
    checkIdb(DataService, $location);

    $scope.addStop = function() {
      var stopnum = prompt("Enter the stop number");

      if (!stopnum) return;

      stopnum = $.trim(stopnum);

      var stopname = prompt("Enter a name for this stop (leave blank for the official name)");
      if (stopname === null) return;

      DataService.addStop(stopnum, stopname);
    };

    $scope.moz = !!navigator.mozApps && !mozApp.isRunning();
    $scope.install = function() {
      mozApp.install(function() {
        toast("Installation successful! Check your apps for this app.", "success");
      }, function() { toast("Installation failed!", "danger"); } );
    };
  }]);


})();
