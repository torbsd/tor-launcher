// Copyright (c) 2013, The Tor Project, Inc.
// See LICENSE for licensing information.
//
// vim: set sw=2 sts=2 ts=8 et syntax=javascript:

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// ctypes can be disabled at build time
try { Cu.import("resource://gre/modules/ctypes.jsm"); } catch(e) {}
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherUtil",
                          "resource://torlauncher/modules/tl-util.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "TorLauncherLogger",
                          "resource://torlauncher/modules/tl-logger.jsm");

function TorProcessService()
{
  this.wrappedJSObject = this;
  this.mProtocolSvc = Cc["@torproject.org/torlauncher-protocol-service;1"]
                .getService(Ci.nsISupports).wrappedJSObject;
}


TorProcessService.prototype =
{
  kContractID : "@torproject.org/torlauncher-process-service;1",
  kServiceName : "Tor Launcher Process Service",
  kClassID: Components.ID("{FE7B4CAF-BCF4-4848-8BFF-EFA66C9AFDA1}"),

  kPrefPromptAtStartup: "extensions.torlauncher.prompt_at_startup",
  kInitialControlConnDelayMS: 25,
  kMaxControlConnRetryMS: 500,
  kControlConnTimeoutMS: 30000, // Wait at most 30 seconds for tor to start.

  // nsISupports implementation.
  QueryInterface: function(aIID)
  {
    if (!aIID.equals(Ci.nsISupports) &&
        !aIID.equals(Ci.nsIFactory) &&
        !aIID.equals(Ci.nsIObserver) &&
        !aIID.equals(Ci.nsIClassInfo))
    {
      throw Cr.NS_ERROR_NO_INTERFACE;
    }

    return this;
  },

  // nsIFactory implementation.
  createInstance: function(aOuter, aIID)
  {
    if (null != aOuter)
      throw Cr.NS_ERROR_NO_AGGREGATION;

    return this.QueryInterface(aIID);
  },

  lockFactory: function(aDoLock) {},

  // nsIObserver implementation.
  observe: function(aSubject, aTopic, aParam)
  {
    const kOpenNetworkSettingsTopic = "TorOpenNetworkSettings";
    const kUserQuitTopic = "TorUserRequestedQuit";
    const kBootstrapStatusTopic = "TorBootstrapStatus";

    if (!this.mObsSvc)
    {
      this.mObsSvc = Cc["@mozilla.org/observer-service;1"]
                        .getService(Ci.nsIObserverService);
    }

    if ("profile-after-change" == aTopic)
    {
      this.mObsSvc.addObserver(this, "quit-application-granted", false);
      this.mObsSvc.addObserver(this, kOpenNetworkSettingsTopic, false);
      this.mObsSvc.addObserver(this, kUserQuitTopic, false);
      this.mObsSvc.addObserver(this, kBootstrapStatusTopic, false);

      if (TorLauncherUtil.shouldStartAndOwnTor)
        this._startTor();
    }
    else if ("quit-application-granted" == aTopic)
    {
      this.mIsQuitting = true;
      this.mObsSvc.removeObserver(this, "quit-application-granted");
      this.mObsSvc.removeObserver(this, kOpenNetworkSettingsTopic);
      this.mObsSvc.removeObserver(this, kUserQuitTopic);
      this.mObsSvc.removeObserver(this, kBootstrapStatusTopic);
      if (this.mTorProcess)
      {
        TorLauncherLogger.log(4, "Shutting down tor process (pid "
                                   + this.mTorProcess.pid + ")");

        var reply = this.mProtocolSvc.TorSendCommand("SIGNAL", "HALT");
        if (!this.mProtocolSvc.TorCommandSucceeded(reply))
          this.mTorProcess.kill();

        this.mTorProcess = null;

        this.mProtocolSvc.TorCleanupConnection();
      }
    }
    else if (("process-failed" == aTopic) || ("process-finished" == aTopic))
    {
      if (this.mControlConnTimer)
      {
        this.mControlConnTimer.cancel();
        this.mControlConnTimer = null;
      }

      this.mTorProcess = null;

      this.mObsSvc.notifyObservers(null, "TorProcessExited", null);

      if (!this.mIsQuitting)
      {
        var s = TorLauncherUtil.getLocalizedString("tor_exited");
        TorLauncherUtil.showAlert(null, s);
        TorLauncherLogger.log(4, s);
      }
    }
    else if ("timer-callback" == aTopic)
    {
      if (aSubject == this.mControlConnTimer)
      {
        var haveConnection = this.mProtocolSvc.TorHaveControlConnection();
        if (haveConnection)
        {
          this.mControlConnTimer = null;
          this.mIsTorProcessReady = true;
          this.mProtocolSvc.TorStartEventMonitor();

          this.mProtocolSvc.TorRetrieveBootstrapStatus();

          this.mObsSvc.notifyObservers(null, "TorProcessIsReady", null);
        }
        else if ((Date.now() - this.mTorProcessStartTime)
                 > this.kControlConnTimeoutMS)
        {
          this.mObsSvc.notifyObservers(null, "TorProcessDidNotStart", null);
          var s = TorLauncherUtil.getLocalizedString("tor_controlconn_failed");
          TorLauncherUtil.showAlert(null, s);
          TorLauncherLogger.log(4, s);
        }
        else
        {
          this.mControlConnDelayMS *= 2;
          if (this.mControlConnDelayMS > this.kMaxControlConnRetryMS)
            this.mControlConnDelayMS = this.kMaxControlConnRetryMS;
          this.mControlConnTimer = Cc["@mozilla.org/timer;1"]
                                  .createInstance(Ci.nsITimer);
          this.mControlConnTimer.init(this, this.mControlConnDelayMS,
                                      this.mControlConnTimer .TYPE_ONE_SHOT);
        }
      }
    }
    else if (kBootstrapStatusTopic == aTopic)
      this._processBootstrapStatus(aSubject.wrappedJSObject);
    else if (kOpenNetworkSettingsTopic == aTopic)
      this._openNetworkSettings(false);
    else if (kUserQuitTopic == aTopic)
      this.mQuitSoon = true;
  },

  canUnload: function(aCompMgr) { return true; },

  // nsIClassInfo implementation.
  getInterfaces: function(aCount)
  {
    var iList = [ Ci.nsISupports,
                  Ci.nsIFactory,
                  Ci.nsIObserver,
                  Ci.nsIClassInfo ];
    aCount.value = iList.length;
    return iList;
  },

  getHelperForLanguage: function (aLanguage) { return null; },

  contractID: this.kContractID,
  classDescription: this.kServiceName,
  classID: this.kClassID,
  implementationLanguage: Ci.nsIProgrammingLanguage.JAVASCRIPT,
  flags: Ci.nsIClassInfo.DOM_OBJECT,

  // nsIFactory implementation.
  createInstance: function (aOuter, aIID)
  {
    if (null != aOuter)
      throw Cr.NS_ERROR_NO_AGGREGATION;

    return this.QueryInterface(aIID);
  },

  lockFactory: function (aDoLock) {},


  // Public Properties and Methods ///////////////////////////////////////////
  get TorIsProcessReady()
  {
    return (this.mTorProcess) ? this.mIsTorProcessReady : false;
  },

  get TorIsBootstrapDone()
  {
    return this.mIsBootstrapDone;
  },

  get TorBootstrapErrorOccurred()
  {
    return this.mBootstrapErrorOccurred;
  },


  TorClearBootstrapError: function()
  {
    this.mLastTorWarningPhase = null;
    this.mLastTorWarningText = null;
  },


  // Private Member Variables ////////////////////////////////////////////////
  mIsTorProcessReady: false,
  mIsBootstrapDone: false,
  mBootstrapErrorOccurred: false,
  mIsQuitting: false,
  mObsSvc: null,
  mProtocolSvc: null,
  mTorProcess: null,    // nsIProcess
  mTorProcessStartTime: null, // JS Date.now()
  mTBBTopDir: null,     // nsIFile for top of TBB installation (cached)
  mControlConnTimer: null,
  mControlConnDelayMS: 0,
  mQuitSoon: false,     // Quit was requested by the user; do so soon.
  mLastTorWarningPhase: null,
  mLastTorWarningText: null,


  // Private Methods /////////////////////////////////////////////////////////
  _startTor: function()
  {
    this.mIsTorProcessReady = false;

    var isInitialBootstrap =
                     TorLauncherUtil.getBoolPref(this.kPrefPromptAtStartup);

    try
    {
      // Ideally, we would cd to the Firefox application directory before
      // starting tor (but we don't know how to do that).  Instead, we
      // rely on the TBB launcher to start Firefox from the right place.
      var exeFile = this._getTorFile("tor");
      var torrcFile = this._getTorFile("torrc");
      var dataDir = this._getTorFile("tordatadir");
      var hashedPassword = this.mProtocolSvc.TorGetPassword(true);

      var detailsKey;
      if (!exeFile)
        detailsKey = "tor_missing";
      else if (!torrcFile)
        detailsKey = "torrc_missing";
      else if (!dataDir)
        detailsKey = "datadir_missing";
      else if (!hashedPassword)
        detailsKey = "password_hash_missing";

      if (detailsKey)
      {
        var details = TorLauncherUtil.getLocalizedString(detailsKey);
        var key = "unable_to_start_tor";
        var err = TorLauncherUtil.getFormattedLocalizedString(key,
                                                                [details], 1);
        TorLauncherUtil.showAlert(null, err);
        return;
      }

      var args = [];
      args.push("-f");
      args.push(torrcFile.path);
      args.push("DataDirectory");
      args.push(dataDir.path);
      args.push("HashedControlPassword");
      args.push(hashedPassword);

      var pid = this._getpid();
      if (0 != pid)
      {
        args.push("__OwningControllerProcess");
        args.push("" + pid);
      }

      if (isInitialBootstrap)
      {
        args.push("DisableNetwork");
        args.push("1");
      }

      var p = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
      p.init(exeFile);

      TorLauncherLogger.log(2, "Starting " + exeFile.path);
      for (var i = 0; i < args.length; ++i)
        TorLauncherLogger.log(2, "  " + args[i]);

      p.runAsync(args, args.length, this, false);
      this.mTorProcess = p;
      this.mTorProcessStartTime = Date.now();

      this._monitorTorProcessStartup();

      if (isInitialBootstrap)
      {
        if (this.mProtocolSvc)
          this._openNetworkSettings(true); // Blocks until dialog is closed.
      }
      else
      {
        this._openProgressDialog();

        // Assume that the "Open Settings" button was pressed if Quit was
        // not pressed and bootstrapping did not finish.
        if (!this.mQuitSoon && !this.TorIsBootstrapDone)
          this._openNetworkSettings(true);
      }

      // If the user pressed "Quit" within settings/progress, exit.
      if (this.mQuitSoon) try
      {
        this.mQuitSoon = false;

        var asSvc = Cc["@mozilla.org/toolkit/app-startup;1"]
                      .getService(Ci.nsIAppStartup);
        asSvc.quit(asSvc.eAttemptQuit);
      }
      catch (e)
      {
        TorLauncherLogger.safelog(4, "unable to quit browser", e);
      }
    }
    catch (e)
    {
      var s = TorLauncherUtil.getLocalizedString("tor_failed_to_start");
      TorLauncherUtil.showAlert(null, s);
      TorLauncherLogger.safelog(4, "_startTor error: ", e);
    }
  }, // _startTor()

  _monitorTorProcessStartup: function()
  {
    this.mControlConnDelayMS = this.kInitialControlConnDelayMS;
    this.mControlConnTimer = Cc["@mozilla.org/timer;1"]
                               .createInstance(Ci.nsITimer);
    this.mControlConnTimer.init(this, this.mControlConnDelayMS,
                                this.mControlConnTimer.TYPE_ONE_SHOT);
  },

  _processBootstrapStatus: function(aStatusObj)
  {
    if (!aStatusObj)
      return;

    if (100 == aStatusObj.PROGRESS)
    {
      this.mIsBootstrapDone = true;
      this.mBootstrapErrorOccurred = false;
      TorLauncherUtil.setBoolPref(this.kPrefPromptAtStartup, false);
    }
    else
    {
      this.mIsBootstrapDone = false;

      if (aStatusObj._errorOccurred)
      {
        this.mBootstrapErrorOccurred = true;
        TorLauncherUtil.setBoolPref(this.kPrefPromptAtStartup, true);
        TorLauncherLogger.log(5, "Tor bootstrap error: " + aStatusObj.WARNING);

        if ((aStatusObj.TAG != this.mLastTorWarningPhase) ||
            (aStatusObj.WARNING != this.mLastTorWarningText))
        {
          this.mLastTorWarningPhase = aStatusObj.TAG;
          this.mLastTorWarningText = aStatusObj.WARNING;

          var s = TorLauncherUtil.getFormattedLocalizedString(
                               "tor_bootstrap_failed", [aStatusObj.WARNING], 1);
          TorLauncherUtil.showAlert(null, s);
        
          this.mObsSvc.notifyObservers(null, "TorBootstrapError",
                                       aStatusObj.WARNING);
        }
      }
    }
  }, // _processBootstrapStatus()

  // Blocks until network settings dialog is closed.
  _openNetworkSettings: function(aIsInitialBootstrap)
  {
    const kSettingsURL = "chrome://torlauncher/content/network-settings.xul";
    const kWizardURL = "chrome://torlauncher/content/network-settings-wizard.xul";

    var wwSvc = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                  .getService(Ci.nsIWindowWatcher);
    var winFeatures = "chrome,dialog=yes,modal,all";
    var argsArray = this._createOpenWindowArgsArray(aIsInitialBootstrap);
    var url = (aIsInitialBootstrap) ? kWizardURL : kSettingsURL;
    wwSvc.openWindow(null, url, "_blank", winFeatures, argsArray);
  },

  _openProgressDialog: function()
  {
    var chromeURL = "chrome://torlauncher/content/progress.xul";
    var wwSvc = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                  .getService(Ci.nsIWindowWatcher);
    var winFeatures = "chrome,dialog=yes,modal,all";
    var argsArray = this._createOpenWindowArgsArray(true);
    wwSvc.openWindow(null, chromeURL, "_blank", winFeatures, argsArray);
  },

  _createOpenWindowArgsArray: function(aBool)
  {
    var argsArray = Cc["@mozilla.org/array;1"]
                      .createInstance(Ci.nsIMutableArray);
    var variant = Cc["@mozilla.org/variant;1"]
                    .createInstance(Ci.nsIWritableVariant);
    variant.setFromVariant(aBool);
    argsArray.appendElement(variant, false);
    return argsArray;
  },

  // Returns an nsIFile.
  // If file doesn't exist, null is returned.
  _getTorFile: function(aTorFileType)
  {
    if (!aTorFileType)
      return null;

    var isRelativePath = true;
    var prefName = "extensions.torlauncher." + aTorFileType + "_path";
    var path = TorLauncherUtil.getCharPref(prefName);
    if (path)
    {
      var re = (TorLauncherUtil.isWindows) ?  /^[A-Za-z]:\\/ : /^\//;
      isRelativePath = !re.test(path);
    }
    else
    {
      // Get default path.
      if (TorLauncherUtil.isMac)
      {
        if ("tor" == aTorFileType)
          path = "Contents/MacOS/tor";
        else if ("torrc" == aTorFileType)
          path = "Library/Vidalia/torrc";
        else if ("tordatadir" == aTorFileType)
          path = "Contents/Resources/Data/Tor/";
      }
      else if (TorLauncherUtil.isWindows)
      {
        if ("tor" == aTorFileType)
          path = "App\\tor.exe";
        else if ("torrc" == aTorFileType)
          path = "Data\\Tor\\torrc";
        else if ("tordatadir" == aTorFileType)
          path = "Data\\Tor";
      }
      else // Linux and others.
      {
        if ("tor" == aTorFileType)
          path = "App/tor";
        else if ("torrc" == aTorFileType)
          path = "Data/Tor/torrc";
        else if ("tordatadir" == aTorFileType)
          path = "Data/Tor/";
      }
    }

    if (!path)
      return null;

    try
    {
      var f;
      if (isRelativePath)
      {
        // Turn into an absolute path (relative to the top of the TBB install).
        if (!this.mTBBTopDir)
        {
          var tbbBrowserDepth = 0;
          if (TorLauncherUtil.isMac)
            tbbBrowserDepth = 5;
          else if (TorLauncherUtil.isWindows)
            tbbBrowserDepth = 3;
          else // Linux and others.
            tbbBrowserDepth = 2;

          var topDir = Cc["@mozilla.org/file/directory_service;1"]
                      .getService(Ci.nsIProperties).get("CurProcD", Ci.nsIFile);
          while (tbbBrowserDepth > 0)
          {
            topDir = topDir.parent;
            tbbBrowserDepth--;
          }

          this.mTBBTopDir = topDir;
        }

        f = this.mTBBTopDir.clone();
        f.appendRelativePath(path);
      }
      else
      {
        f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
        f.initWithPath(path);
      }

      if (f.exists())
      {
        try { f.normalize(); } catch(e) {}

        return f;
      }

      TorLauncherLogger.log(4, aTorFileType + " file not found: " + f.path);
    }
    catch(e)
    {
      TorLauncherLogger.safelog(4, "_getTorFile " + aTorFileType +
                                     " failed for " + path + ": ", e);
    }

    return null;  // File not found or error (logged above).
  }, // _getTorFile()

  _getpid: function()
  {
    // Use nsIXULRuntime.processID if it is available.
    var pid = 0;

    try
    {
      var xreSvc = Cc["@mozilla.org/xre/app-info;1"]
                     .getService(Ci.nsIXULRuntime);
      pid = xreSvc.processID;
    }
    catch (e)
    {
      TorLauncherLogger.safelog(2, "failed to get process ID via XUL runtime:",
                                e);
    }

    // Try libc.getpid() via js-ctypes.
    if (!pid) try
    {
      var getpid;
      if (TorLauncherUtil.isMac)
      {
        var libc = ctypes.open("libc.dylib");
        getpid = libc.declare("getpid", ctypes.default_abi, ctypes.uint32_t);
      }
      else if (TorLauncherUtil.isWindows)
      {
        var libc = ctypes.open("Kernel32.dll");
        getpid = libc.declare("GetCurrentProcessId", ctypes.default_abi,
                              ctypes.uint32_t);
      }
      else // Linux and others.
      {
        var libc;
        try
        {
          libc = ctypes.open("libc.so.6");
        }
        catch(e)
        {
          libc = ctypes.open("libc.so");
        }

        getpid = libc.declare("getpid", ctypes.default_abi, ctypes.int);
      }

      pid = getpid();
    }
    catch(e)
    {
      TorLauncherLogger.safelog(4, "unable to get process ID: ", e);
    }

    return pid;
  },

  endOfObject: true
};


var gTorProcessService = new TorProcessService;


// TODO: Mark wants to research use of XPCOMUtils.generateNSGetFactory
// Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
function NSGetFactory(aClassID)
{
  if (!aClassID.equals(gTorProcessService.kClassID))
    throw Cr.NS_ERROR_FACTORY_NOT_REGISTERED;

  return gTorProcessService;
}
